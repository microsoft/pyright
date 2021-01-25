import os
import platform
import subprocess
import sys


def main() -> None:
    base = os.path.dirname(os.path.abspath(__file__))
    if platform.system().lower() == "windows":
        if sys.maxsize > 2 ** 32:
            subprocess.check_call(
                [os.path.join(base, "pyright-win-x64.exe"), *sys.argv[1:]]
            )
        return
        subprocess.check_call(
            [os.path.join(base, "pyright-win-x86.exe"), *sys.argv[1:]]
        )
        return
    elif platform.system().lower() == "linux":
        subprocess.check_call([os.path.join(base, "pyright-linux-x64"), *sys.argv[1:]])
        return
    elif platform.system().lower() == "darwin":
        subprocess.check_call([os.path.join(base, "pyright-macos-x64"), *sys.argv[1:]])
        return
    print("Executable not found for your system.")
    exit(1)
