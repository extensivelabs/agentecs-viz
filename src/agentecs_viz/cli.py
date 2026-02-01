"""CLI entry point for AgentECS visualization server.

Usage:
    agentecs-viz serve                    # Start with MockWorldSource
    agentecs-viz serve --mock            # Explicit mock mode
    agentecs-viz serve -m myapp.world    # Load world from module
    agentecs-viz serve --port 3000       # Custom port
    agentecs-viz serve --record-to trace.jsonl  # Record while serving

    agentecs-viz record -o trace.jsonl   # Record mock source to file
    agentecs-viz record -m myapp.world -o trace.jsonl  # Record from module
    agentecs-viz record --mock -o trace.jsonl --ticks 50  # Record N ticks

    agentecs-viz replay trace.jsonl      # Replay a recorded trace
    agentecs-viz replay trace.jsonl --speed 2.0  # Replay at 2x speed
"""

from __future__ import annotations

import argparse
import importlib
import json
import logging
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agentecs_viz.protocol import WorldStateSource

logger = logging.getLogger(__name__)


def get_frontend_dir() -> Path:
    """Get the path to the frontend dist directory."""
    # Try relative to this file (in development)
    # cli.py is at viz/src/agentecs_viz/cli.py, frontend is at viz/frontend/dist
    dev_path = Path(__file__).parent.parent.parent / "frontend" / "dist"
    if dev_path.exists():
        return dev_path

    # Try installed package location
    pkg_path = Path(__file__).parent / "frontend"
    if pkg_path.exists():
        return pkg_path

    raise FileNotFoundError("Frontend dist not found. Run 'npm run build' in viz/frontend/")


def load_world_source(module_path: str) -> WorldStateSource:
    """Load WorldStateSource from a module path.

    The module should have either:
    - A `get_world_source()` function returning a WorldStateSource
    - A `world_source` attribute that is a WorldStateSource
    - A `world` attribute that can be wrapped with LocalWorldSource

    Args:
        module_path: Dotted module path (e.g., 'myapp.world')

    Returns:
        WorldStateSource instance.

    Raises:
        ImportError: If module cannot be imported.
        AttributeError: If module doesn't have expected attributes.
    """
    from agentecs_viz.sources.local import LocalWorldSource

    try:
        module = importlib.import_module(module_path)
    except ImportError as e:
        raise ImportError(f"Cannot import module '{module_path}': {e}") from e

    # Try get_world_source() function first
    if hasattr(module, "get_world_source"):
        return module.get_world_source()

    # Try world_source attribute
    if hasattr(module, "world_source"):
        return module.world_source

    # Try wrapping a World instance
    if hasattr(module, "world"):
        return LocalWorldSource(module.world, tick_interval=0.5)

    raise AttributeError(
        f"Module '{module_path}' must have 'get_world_source()', "
        "'world_source', or 'world' attribute"
    )


def create_parser() -> argparse.ArgumentParser:
    """Create the argument parser."""
    parser = argparse.ArgumentParser(
        prog="agentecs-viz",
        description="AgentECS visualization server",
    )
    parser.add_argument(
        "--version",
        action="version",
        version="%(prog)s 0.1.0",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # serve command
    serve_parser = subparsers.add_parser(
        "serve",
        help="Start the visualization server",
    )
    serve_parser.add_argument(
        "-m",
        "--world-module",
        metavar="MODULE",
        help="Python module path containing world (e.g., 'myapp.world')",
    )
    serve_parser.add_argument(
        "--mock",
        action="store_true",
        help="Use MockWorldSource for demo/testing",
    )
    serve_parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=8000,
        help="Server port (default: 8000)",
    )
    serve_parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Server host (default: 127.0.0.1)",
    )
    serve_parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="Don't serve frontend static files",
    )
    serve_parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )
    serve_parser.add_argument(
        "--record-to",
        metavar="FILE",
        help="Record trace to file while serving",
    )

    # record command
    record_parser = subparsers.add_parser(
        "record",
        help="Record world trace to file",
    )
    record_parser.add_argument(
        "-o",
        "--output",
        metavar="FILE",
        required=True,
        help="Output file path (JSON Lines format)",
    )
    record_parser.add_argument(
        "-m",
        "--world-module",
        metavar="MODULE",
        help="Python module path containing world",
    )
    record_parser.add_argument(
        "--mock",
        action="store_true",
        help="Use MockWorldSource for recording",
    )
    record_parser.add_argument(
        "--ticks",
        type=int,
        help="Number of ticks to record",
    )
    record_parser.add_argument(
        "--duration",
        type=float,
        help="Max duration in seconds",
    )
    record_parser.add_argument(
        "--tick-interval",
        type=float,
        default=0.5,
        help="Interval between ticks in seconds (default: 0.5)",
    )
    record_parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    # replay command
    replay_parser = subparsers.add_parser(
        "replay",
        help="Replay a recorded trace",
    )
    replay_parser.add_argument(
        "file",
        metavar="FILE",
        help="Trace file to replay (JSON Lines format)",
    )
    replay_parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=8000,
        help="Server port (default: 8000)",
    )
    replay_parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Server host (default: 127.0.0.1)",
    )
    replay_parser.add_argument(
        "--speed",
        type=float,
        default=1.0,
        help="Playback speed multiplier (default: 1.0)",
    )
    replay_parser.add_argument(
        "--no-frontend",
        action="store_true",
        help="Don't serve frontend static files",
    )
    replay_parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    return parser


def cmd_serve(args: argparse.Namespace) -> int:
    """Run the serve command."""
    import uvicorn
    from fastapi.staticfiles import StaticFiles

    from agentecs_viz.server import create_app

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    # Get world source
    source: WorldStateSource
    if args.world_module:
        try:
            source = load_world_source(args.world_module)
            logger.info(f"Loaded world source from '{args.world_module}'")
        except (ImportError, AttributeError) as e:
            logger.error(str(e))
            return 1
    else:
        # Default to mock source with history capturing for timeline support
        from agentecs_viz.history import HistoryCapturingSource
        from agentecs_viz.sources.mock import MockWorldSource

        mock_source = MockWorldSource(
            entity_count=10,
            tick_interval=0.5,
        )
        source = HistoryCapturingSource(mock_source, max_ticks=1000)
        logger.info("Using MockWorldSource with history capture (demo mode)")

    # Wrap with file recording if --record-to specified
    if args.record_to:
        from agentecs_viz.history import FileHistoryStore, HistoryCapturingSource

        record_path = Path(args.record_to)
        file_store = FileHistoryStore(record_path, mode="w")
        source = HistoryCapturingSource(source, store=file_store)
        logger.info(f"Recording trace to {record_path}")

    # Create app
    app = create_app(source)

    # Mount frontend static files
    if not args.no_frontend:
        try:
            frontend_dir = get_frontend_dir()
            app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
            logger.info(f"Serving frontend from {frontend_dir}")
        except FileNotFoundError as e:
            logger.warning(f"{e} - Running API only")

    # Print startup message
    url = f"http://{args.host}:{args.port}"
    print()
    print("=" * 50)
    print("  AgentECS Visualizer")
    print("=" * 50)
    print(f"  Server:    {url}")
    print(f"  API:       {url}/docs")
    print(f"  WebSocket: ws://{args.host}:{args.port}/ws")
    print(f"  Source:    {type(source).__name__}")
    print("=" * 50)
    print()

    # Run server
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="debug" if args.verbose else "info",
    )

    return 0


def cmd_record(args: argparse.Namespace) -> int:
    """Run the record command."""
    import asyncio
    import signal
    import time

    from agentecs.tracing import TickRecord

    from agentecs_viz.history import FileHistoryStore
    from agentecs_viz.protocol import TickEvent

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    # Get world source
    source: WorldStateSource
    if args.world_module:
        try:
            source = load_world_source(args.world_module)
            logger.info(f"Loaded world source from '{args.world_module}'")
        except (ImportError, AttributeError) as e:
            logger.error(str(e))
            return 1
    else:
        # Default to mock source
        from agentecs_viz.sources.mock import MockWorldSource

        source = MockWorldSource(
            entity_count=10,
            tick_interval=args.tick_interval,
        )
        logger.info("Using MockWorldSource for recording")

    # Create file store
    output_path = Path(args.output)
    store = FileHistoryStore(output_path, mode="w")

    print()
    print("=" * 50)
    print("  AgentECS Trace Recorder")
    print("=" * 50)
    print(f"  Output:    {output_path}")
    print(f"  Source:    {type(source).__name__}")
    if args.ticks:
        print(f"  Max ticks: {args.ticks}")
    if args.duration:
        print(f"  Duration:  {args.duration}s")
    print("  Press Ctrl+C to stop recording")
    print("=" * 50)
    print()

    async def record_ticks() -> int:
        """Record ticks from source to store."""
        stop_requested = False
        tick_count = 0
        start_time = time.time()

        def handle_signal(*_: object) -> None:
            nonlocal stop_requested
            stop_requested = True
            print("\nStopping recording...")

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        try:
            await source.connect()
            logger.info("Connected to source, starting recording...")

            async for event in source.subscribe_events():
                if stop_requested:
                    break

                if isinstance(event, TickEvent):
                    snapshot = event.snapshot
                    record = TickRecord(
                        tick=snapshot.tick,
                        timestamp=time.time(),
                        snapshot=snapshot.model_dump(),
                        events=[],
                    )
                    store.record_tick(record)
                    tick_count += 1

                    # Progress output
                    if tick_count % 10 == 0:
                        print(f"  Recorded {tick_count} ticks...", end="\r")

                    # Check limits
                    if args.ticks and tick_count >= args.ticks:
                        logger.info(f"Reached tick limit ({args.ticks})")
                        break
                    if args.duration:
                        elapsed = time.time() - start_time
                        if elapsed >= args.duration:
                            logger.info(f"Reached duration limit ({args.duration}s)")
                            break

        finally:
            await source.disconnect()
            store.close()

        return tick_count

    tick_count = asyncio.run(record_ticks())

    print()
    print(f"Recorded {tick_count} ticks to {output_path}")
    print(f"File size: {output_path.stat().st_size:,} bytes")

    return 0


def cmd_replay(args: argparse.Namespace) -> int:
    """Run the replay command."""
    import uvicorn
    from fastapi.staticfiles import StaticFiles

    from agentecs_viz.history import FileHistoryStore
    from agentecs_viz.server import create_app
    from agentecs_viz.sources.replay import ReplayWorldSource

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    # Open trace file
    trace_path = Path(args.file)
    if not trace_path.exists():
        logger.error(f"Trace file not found: {trace_path}")
        return 1

    try:
        store = FileHistoryStore(trace_path, mode="r")
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"Failed to open trace file: {e}")
        return 1

    tick_range = store.get_tick_range()
    if not tick_range:
        logger.error("Trace file is empty")
        store.close()
        return 1

    # Create replay source
    source = ReplayWorldSource(
        store,
        tick_interval=0.5 / args.speed,  # Adjust for speed
    )

    # Create app
    app = create_app(source)

    # Mount frontend static files
    if not args.no_frontend:
        try:
            frontend_dir = get_frontend_dir()
            app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
            logger.info(f"Serving frontend from {frontend_dir}")
        except FileNotFoundError as e:
            logger.warning(f"{e} - Running API only")

    # Print startup message
    url = f"http://{args.host}:{args.port}"
    print()
    print("=" * 50)
    print("  AgentECS Trace Replay")
    print("=" * 50)
    print(f"  Server:    {url}")
    print(f"  Trace:     {trace_path}")
    print(f"  Ticks:     {tick_range[0]} - {tick_range[1]} ({store.tick_count} total)")
    print(f"  Speed:     {args.speed}x")
    print("=" * 50)
    print()

    # Run server
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="debug" if args.verbose else "info",
    )

    store.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    """Main entry point."""
    parser = create_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return 0

    if args.command == "serve":
        return cmd_serve(args)
    elif args.command == "record":
        return cmd_record(args)
    else:  # args.command == "replay"
        return cmd_replay(args)


if __name__ == "__main__":
    sys.exit(main())
