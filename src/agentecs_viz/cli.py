"""CLI entry point for AgentECS visualization server."""

from __future__ import annotations

import argparse
import importlib
import logging
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agentecs_viz.protocol import WorldStateSource

logger = logging.getLogger(__name__)


def get_frontend_dir() -> Path:
    """Get frontend dist directory, checking dev path then installed package."""
    dev_path = Path(__file__).parent.parent.parent / "frontend" / "dist"
    if dev_path.exists():
        return dev_path

    pkg_path = Path(__file__).parent / "frontend"
    if pkg_path.exists():
        return pkg_path

    raise FileNotFoundError("Frontend dist not found. Run 'npm run build' in frontend/")


def load_world_source(module_path: str) -> WorldStateSource:
    """Load WorldStateSource from a module's ``get_world_source()`` or ``world_source``."""
    try:
        module = importlib.import_module(module_path)
    except ImportError as e:
        raise ImportError(f"Cannot import module '{module_path}': {e}") from e

    if hasattr(module, "get_world_source"):
        return module.get_world_source()  # type: ignore[no-any-return]

    if hasattr(module, "world_source"):
        return module.world_source  # type: ignore[no-any-return]

    raise AttributeError(
        f"Module '{module_path}' must have 'get_world_source()' or 'world_source' attribute"
    )


def create_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
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

    serve_parser = subparsers.add_parser("serve", help="Start the visualization server")
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

    return parser


def cmd_serve(args: argparse.Namespace) -> int:
    """Run the visualization server."""
    import uvicorn
    from fastapi.staticfiles import StaticFiles

    from agentecs_viz.server import create_app

    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    source: WorldStateSource
    if args.world_module:
        try:
            source = load_world_source(args.world_module)
            logger.info("Loaded world source from '%s'", args.world_module)
        except (ImportError, AttributeError) as e:
            logger.error(str(e))
            return 1
    else:
        from agentecs_viz.sources.mock import MockWorldSource

        source = MockWorldSource(entity_count=10, tick_interval=0.5)
        logger.info("Using MockWorldSource (demo mode)")

    app = create_app(source)

    if not args.no_frontend:
        try:
            frontend_dir = get_frontend_dir()
            app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
            logger.info("Serving frontend from %s", frontend_dir)
        except FileNotFoundError as e:
            logger.warning("%s - Running API only", e)

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

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="debug" if args.verbose else "info",
    )

    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = create_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return 0

    if args.command == "serve":
        return cmd_serve(args)

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
