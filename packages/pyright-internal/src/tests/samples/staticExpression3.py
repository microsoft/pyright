import os
import sys


class FakeSys:
    version_info: tuple[int, ...] = (2, 7)
    platform: str = "win32"


class FakeOs:
    name: str = "nt"


def func(sys: FakeSys, os: FakeOs) -> None:
    if sys.version_info < (3, 0):
        reveal_type(sys)
        reveal_type(sys, expected_text="FakeSys")

    if sys.version_info[0] < 3:
        reveal_type(sys)
        reveal_type(sys, expected_text="FakeSys")

    if sys.platform == "win32":
        reveal_type(sys)
        reveal_type(sys, expected_text="FakeSys")

    if os.name == "nt":
        reveal_type(os)
        reveal_type(os, expected_text="FakeOs")
