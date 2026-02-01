"""Tests for the CLI module."""

import pytest
from agentecs_viz.cli import create_parser, get_frontend_dir, load_world_source


class TestArgumentParser:
    """Tests for argument parsing."""

    def test_parser_no_command_exits_cleanly(self) -> None:
        """Parser with no command should not raise."""
        parser = create_parser()
        args = parser.parse_args([])
        assert args.command is None

    def test_serve_default_values(self) -> None:
        """Serve command has correct defaults."""
        parser = create_parser()
        args = parser.parse_args(["serve"])

        assert args.command == "serve"
        assert args.world_module is None
        assert args.mock is False
        assert args.port == 8000
        assert args.host == "127.0.0.1"
        assert args.no_frontend is False
        assert args.verbose is False

    def test_serve_with_world_module(self) -> None:
        """World module flag is parsed correctly."""
        parser = create_parser()
        args = parser.parse_args(["serve", "-m", "myapp.world"])

        assert args.world_module == "myapp.world"

    def test_serve_with_port(self) -> None:
        """Port flag is parsed correctly."""
        parser = create_parser()
        args = parser.parse_args(["serve", "--port", "3000"])

        assert args.port == 3000

    def test_serve_with_mock_flag(self) -> None:
        """Mock flag is parsed correctly."""
        parser = create_parser()
        args = parser.parse_args(["serve", "--mock"])

        assert args.mock is True

    def test_serve_with_all_options(self) -> None:
        """All options together are parsed correctly."""
        parser = create_parser()
        args = parser.parse_args(
            [
                "serve",
                "-m",
                "myapp.world",
                "--port",
                "9000",
                "--host",
                "0.0.0.0",
                "--no-frontend",
                "-v",
            ]
        )

        assert args.world_module == "myapp.world"
        assert args.port == 9000
        assert args.host == "0.0.0.0"
        assert args.no_frontend is True
        assert args.verbose is True


class TestFrontendDir:
    """Tests for frontend directory resolution."""

    def test_get_frontend_dir_finds_dist(self) -> None:
        """Frontend dir should resolve to the dist folder when built."""
        try:
            frontend_dir = get_frontend_dir()
            assert frontend_dir.exists()
            assert frontend_dir.name == "dist"
        except FileNotFoundError:
            pytest.skip("Frontend not built (run 'task frontend:build')")


class TestLoadWorldSource:
    """Tests for world source loading."""

    def test_load_nonexistent_module_raises(self) -> None:
        """Loading a non-existent module raises ImportError."""
        with pytest.raises(ImportError, match="Cannot import module"):
            load_world_source("nonexistent.module.path")

    def test_load_module_without_world_raises(self) -> None:
        """Loading a module without world attributes raises."""
        # logging module exists but doesn't have world attributes
        with pytest.raises(AttributeError, match="must have"):
            load_world_source("logging")
