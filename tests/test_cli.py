from __future__ import annotations

from types import ModuleType
from unittest.mock import patch

import pytest

from agentecs_viz.cli import cmd_serve, create_parser, get_frontend_dir, load_world_source, main
from agentecs_viz.sources.mock import MockWorldSource


class TestCreateParser:
    def test_serve_defaults(self):
        parser = create_parser()
        args = parser.parse_args(["serve"])
        assert args.command == "serve"
        assert args.port == 8000
        assert args.host == "127.0.0.1"
        assert args.mock is False
        assert args.no_frontend is False
        assert args.verbose is False

    def test_serve_with_options(self):
        parser = create_parser()
        args = parser.parse_args(
            ["serve", "--mock", "-p", "3000", "--host", "0.0.0.0", "-v", "--no-frontend"]
        )
        assert args.mock is True
        assert args.port == 3000
        assert args.host == "0.0.0.0"
        assert args.verbose is True
        assert args.no_frontend is True

    def test_serve_with_module(self):
        parser = create_parser()
        args = parser.parse_args(["serve", "-m", "myapp.world"])
        assert args.world_module == "myapp.world"

    def test_no_command(self):
        parser = create_parser()
        args = parser.parse_args([])
        assert args.command is None

    def test_version(self, capsys):
        from agentecs_viz._version import __version__

        parser = create_parser()
        with pytest.raises(SystemExit, match="0"):
            parser.parse_args(["--version"])
        captured = capsys.readouterr()
        assert __version__ in captured.out


class TestGetFrontendDir:
    def test_prefers_dev_dist_path(self):
        with patch("agentecs_viz.cli.Path.exists", side_effect=[True]):
            result = get_frontend_dir()

        assert str(result).endswith("frontend/dist")

    def test_falls_back_to_package_frontend_path(self):
        with patch("agentecs_viz.cli.Path.exists", side_effect=[False, True]):
            result = get_frontend_dir()

        assert str(result).endswith("agentecs_viz/frontend")

    def test_not_found(self):
        with (
            patch("agentecs_viz.cli.Path.exists", return_value=False),
            pytest.raises(FileNotFoundError),
        ):
            get_frontend_dir()


class TestLoadWorldSource:
    def test_loads_from_get_world_source(self):
        source = MockWorldSource(entity_count=1)
        module = ModuleType("dummy_world_module")
        module.get_world_source = lambda: source  # type: ignore[attr-defined]

        with patch("agentecs_viz.cli.importlib.import_module", return_value=module):
            loaded = load_world_source("dummy_world_module")

        assert loaded is source

    def test_loads_from_world_source_attribute(self):
        source = MockWorldSource(entity_count=1)
        module = ModuleType("dummy_world_module")
        module.world_source = source  # type: ignore[attr-defined]

        with patch("agentecs_viz.cli.importlib.import_module", return_value=module):
            loaded = load_world_source("dummy_world_module")

        assert loaded is source

    def test_rejects_invalid_get_world_source_result(self):
        module = ModuleType("dummy_world_module")
        module.get_world_source = lambda: object()  # type: ignore[attr-defined]

        with (
            patch("agentecs_viz.cli.importlib.import_module", return_value=module),
            pytest.raises(TypeError, match="expected WorldStateSource"),
        ):
            load_world_source("dummy_world_module")

    def test_rejects_invalid_world_source_attribute(self):
        module = ModuleType("dummy_world_module")
        module.world_source = object()  # type: ignore[attr-defined]

        with (
            patch("agentecs_viz.cli.importlib.import_module", return_value=module),
            pytest.raises(TypeError, match="expected WorldStateSource"),
        ):
            load_world_source("dummy_world_module")

    def test_requires_provider_attribute(self):
        module = ModuleType("dummy_world_module")

        with (
            patch("agentecs_viz.cli.importlib.import_module", return_value=module),
            pytest.raises(AttributeError, match=r"must have 'get_world_source\(\)'"),
        ):
            load_world_source("dummy_world_module")

    def test_import_error_wrapped(self):
        with (
            patch("agentecs_viz.cli.importlib.import_module", side_effect=ImportError("boom")),
            pytest.raises(ImportError, match="Cannot import module"),
        ):
            load_world_source("bad.module")


class TestCmdServe:
    def test_cmd_serve_mock_no_frontend(self):
        args = create_parser().parse_args(["serve", "--mock", "--no-frontend"])

        with patch("uvicorn.run") as run:
            result = cmd_serve(args)

        assert result == 0
        run.assert_called_once()

    def test_cmd_serve_world_module(self):
        args = create_parser().parse_args(["serve", "--world-module", "my.world", "--no-frontend"])
        source = MockWorldSource(entity_count=1)

        with (
            patch("agentecs_viz.cli.load_world_source", return_value=source),
            patch("uvicorn.run") as run,
        ):
            result = cmd_serve(args)

        assert result == 0
        run.assert_called_once()

    def test_cmd_serve_world_module_type_error_returns_1(self):
        args = create_parser().parse_args(["serve", "--world-module", "my.world", "--no-frontend"])

        with patch("agentecs_viz.cli.load_world_source", side_effect=TypeError("bad source")):
            result = cmd_serve(args)

        assert result == 1


class TestMain:
    def test_no_args_returns_0(self):
        result = main([])
        assert result == 0

    def test_serve_no_source_returns_1(self):
        result = main(["serve", "--no-frontend"])
        assert result == 1

    def test_serve_mock_executes(self):
        with patch("uvicorn.run"):
            result = main(["serve", "--mock", "--no-frontend"])
        assert result == 0
