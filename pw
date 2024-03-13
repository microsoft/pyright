#!/usr/bin/env python3

##################################################################################
# Pyprojectx wrapper script                                                      #
# https://github.com/pyprojectx/pyprojectx                                       #
#                                                                                #
# Copyright (c) 2021 Ivo Houbrechts                                              #
#                                                                                #
# Licensed under the MIT license                                                 #
##################################################################################
import argparse
import os
import subprocess
import sys
from pathlib import Path
from venv import EnvBuilder

VERSION = "2.1.6"

PYPROJECTX_INSTALL_DIR_ENV_VAR = "PYPROJECTX_INSTALL_DIR"
PYPROJECTX_PACKAGE_ENV_VAR = "PYPROJECTX_PACKAGE"
PYPROJECT_TOML = "pyproject.toml"
DEFAULT_INSTALL_DIR = ".pyprojectx"

CYAN = "\033[96m"
BLUE = "\033[94m"
RED = "\033[91m"
RESET = "\033[0m"
if sys.platform.startswith("win"):
    os.system("color")


def run(args):
    try:
        options = get_options(args)
        pyprojectx_script = ensure_pyprojectx(options)
        explicit_options = []
        if not options.toml:
            explicit_options += ["--toml", str(options.toml_path)]
        if not options.install_dir:
            explicit_options += ["--install-dir", str(options.install_path)]

        subprocess.run([str(pyprojectx_script), *explicit_options, *args], check=True)
    except subprocess.CalledProcessError as e:
        raise SystemExit(e.returncode) from e


def get_options(args):
    options = arg_parser().parse_args(args)
    options.install_path = Path(
        options.install_dir
        or os.environ.get(PYPROJECTX_INSTALL_DIR_ENV_VAR, Path(__file__).with_name(DEFAULT_INSTALL_DIR))
    )
    options.toml_path = Path(options.toml) if options.toml else Path(__file__).with_name(PYPROJECT_TOML)
    if os.environ.get(PYPROJECTX_PACKAGE_ENV_VAR):
        options.version = "development"
        options.pyprojectx_package = os.environ.get(PYPROJECTX_PACKAGE_ENV_VAR)
    else:
        options.version = VERSION
        options.pyprojectx_package = f"pyprojectx~={VERSION}"
    options.verbosity = 0 if options.quiet or not options.verbosity else options.verbosity
    return options


def arg_parser():
    parser = argparse.ArgumentParser(
        description="Execute commands or aliases defined in the [tool.pyprojectx] section of pyproject.toml. "
        "Use the -i or --info option to see available tools and aliases.",
        allow_abbrev=False,
    )
    parser.add_argument("--version", action="version", version=VERSION)
    parser.add_argument(
        "--toml",
        "-t",
        action="store",
        help="The toml config file. Defaults to 'pyproject.toml' in the same directory as the pw script.",
    )
    parser.add_argument(
        "--install-dir",
        action="store",
        help=f"The directory where all tools (including pyprojectx) are installed; defaults to the "
        f"{PYPROJECTX_INSTALL_DIR_ENV_VAR} environment value if set, else '.pyprojectx' "
        f"in the same directory as the invoked pw script",
    )
    parser.add_argument(
        "--force-install",
        "-f",
        action="store_true",
        help="Force clean installation of the virtual environment used to run cmd, if any",
    )
    parser.add_argument(
        "--install-context",
        action="store",
        metavar="tool-context",
        help="Install a tool context without actually running any command.",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="count",
        dest="verbosity",
        help="Give more output. This option is additive and can be used up to 2 times.",
    )
    parser.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="Suppress output",
    )
    parser.add_argument(
        "--info",
        "-i",
        action="store_true",
        help="Show the configuration details of a command instead of running it. "
        "If no command is specified, a list with all available tools and aliases is shown.",
    )
    parser.add_argument(
        "--add",
        action="store",
        metavar="[context:]<package>,<package>...",
        help="Add one or more packages to a tool context. "
        "If no context is specified, the packages are added to the main context. "
        "Packages can be specified as in 'pip install', except that a ',' can't be used in the version specification.",
    )
    parser.add_argument(
        "--lock",
        action="store_true",
        help="Write all dependencies of all tool contexts to 'pw.lock' to guarantee reproducible outcomes.",
    )
    parser.add_argument(
        "--install-px", action="store_true", help="Install the px and pxg scripts in your home directory."
    )
    parser.add_argument(
        "--upgrade",
        action="store_true",
        help="Print instructions to download the latest pyprojectx wrapper scripts.",
    )
    parser.add_argument(
        "command", nargs=argparse.REMAINDER, help="The command/alias with optional arguments to execute."
    )
    return parser


def ensure_pyprojectx(options):
    env_builder = EnvBuilder(with_pip=True)
    venv_dir = options.install_path.joinpath(
        "pyprojectx", f"{options.version}-py{sys.version_info.major}.{sys.version_info.minor}"
    )
    env_context = env_builder.ensure_directories(venv_dir)
    pyprojectx_script = Path(env_context.bin_path, "pyprojectx")
    pyprojectx_exe = Path(env_context.bin_path, "pyprojectx.exe")
    pip_cmd = [env_context.env_exe, "-m", "pip", "install"]

    if options.quiet:
        out = subprocess.DEVNULL
        pip_cmd.append("--quiet")
    else:
        out = sys.stderr

    if not pyprojectx_script.is_file() and not pyprojectx_exe.is_file():
        if not options.quiet:
            print(f"{CYAN}creating pyprojectx venv in {BLUE}{venv_dir}{RESET}", file=sys.stderr)
        env_builder.create(venv_dir)
        subprocess.run(
            [*pip_cmd, "--upgrade", "pip"],
            stdout=out,
            check=True,
        )

        if not options.quiet:
            print(
                f"{CYAN}installing pyprojectx {BLUE}{options.version}: {options.pyprojectx_package} {RESET}",
                file=sys.stderr,
            )
        if options.version == "development":
            if not options.quiet:
                print(
                    f"{RED}WARNING: {options.pyprojectx_package} is installed in editable mode{RESET}",
                    file=sys.stderr,
                )
            pip_cmd.append("-e")
        subprocess.run([*pip_cmd, options.pyprojectx_package], stdout=out, check=True)
    return pyprojectx_script


if __name__ == "__main__":
    run(sys.argv[1:])
