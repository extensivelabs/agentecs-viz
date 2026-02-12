from unittest.mock import patch

from agentecs_viz.cli import create_parser, get_frontend_dir, main


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
        import pytest

        from agentecs_viz._version import __version__

        parser = create_parser()
        with pytest.raises(SystemExit, match="0"):
            parser.parse_args(["--version"])
        captured = capsys.readouterr()
        assert __version__ in captured.out


class TestGetFrontendDir:
    def test_not_found(self):
        import pytest

        with patch("agentecs_viz.cli.Path") as mock_path:
            mock_inst = mock_path.return_value
            dev = mock_inst.parent.parent.parent.__truediv__.return_value
            dev.__truediv__.return_value.exists.return_value = False
            mock_inst.parent.__truediv__.return_value.exists.return_value = False

            with pytest.raises(FileNotFoundError):
                get_frontend_dir()


class TestMain:
    def test_no_args_returns_0(self):
        result = main([])
        assert result == 0

    def test_serve_no_source_returns_1(self):
        result = main(["serve", "--no-frontend"])
        assert result == 1
