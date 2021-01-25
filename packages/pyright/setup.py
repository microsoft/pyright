import glob
import os
import shutil
import subprocess
import sys
from tempfile import mkdtemp
from zipfile import ZipFile

from setuptools import setup
from wheel.bdist_wheel import bdist_wheel as _bdist_wheel


class bdist_wheel(_bdist_wheel):
    def run(self) -> None:
        subprocess.check_call(["npm", "run", "prepack"], shell=True)
        super().run()
        base_wheel_location = glob.glob("dist/*.whl")[0]
        without_platform = base_wheel_location[:-7]
        platform_map = {
            "darwin": "mac",
            "linux": "linux",
            "win32": "win32_x64" if sys.maxsize > 2 ** 32 else "win32",
        }
        wheel_map = {
            "mac": "macosx_10_13_x86_64.whl",
            "linux": "manylinux1_x86_64.whl",
            "win32": "win32.whl",
            "win32_x64": "win_amd64.whl",
        }
        binary_map = {
            "mac": "pyright-macos-x64",
            "linux": "pyright-linux-x64",
            "win32": "pyright-win-x86.exe",
            "win32_x64": "pyright-win-x64.exe",
        }
        temp_dir = mkdtemp()
        subprocess.check_call(
            [
                "pkg",
                "-t",
                "node14-win-x64,node14-win-x86,node14-linux-x64,node14-linux-x64,node14-macos-x64",
                ".",
                "--out-path",
                temp_dir,
            ],
            shell=True,
        )
        if sys.platform == "win32":
            binary = binary_map["win32_x64" if sys.maxsize > 2 ** 32 else "win32"]
            shutil.copyfile(
                os.path.join(temp_dir, binary),
                os.path.join("pyright", binary),
            )
        else:
            shutil.copyfile(
                os.path.join(temp_dir, binary_map[platform_map[sys.platform]]),
                os.path.join("pyright", binary_map[platform_map[sys.platform]]),
            )

        for platform in ["mac", "linux", "win32", "win32_x64"]:
            wheel_location = without_platform + wheel_map[platform]
            shutil.copyfile(base_wheel_location, wheel_location)
            with ZipFile(wheel_location, "a") as zip:
                zip.write(
                    os.path.join(temp_dir, binary_map[platform]),
                    f"pyright/{binary_map[platform]}",
                )
        shutil.rmtree(temp_dir)
        os.remove(base_wheel_location)


setup(
    name="pyright",
    version="1.0",
    author="Microsoft Corporation",
    description="Pyright is a fast type checker meant for large Python source bases. It can run in a “watch” mode and performs fast incremental updates when files are modified.",
    long_description="",
    long_description_content_type="text/markdown",
    url="https://github.com/Microsoft/pyright",
    packages=["pyright"],
    include_package_data=True,
    cmdclass={"bdist_wheel": bdist_wheel},
    entry_points={
        "console_scripts": [
            "pyright=pyright:main",
        ]
    },
    python_requires=">=3.7",
    setup_requires=["wheel"],
)
