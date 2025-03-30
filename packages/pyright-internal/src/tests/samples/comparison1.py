# This sample tests the check for non-overlapping types compared
# with equals comparison.

from typing import Literal, TypeVar


OS = Literal["Linux", "Darwin", "Windows"]


def func1(os: OS, val: Literal[1, "linux"]):
    if os == "Linux":
        return True

    # This should generate an error because this expression will always
    # evaluate to False.
    if os == "darwin":
        return False

    # This should generate an error because this expression will always
    # evaluate to True.
    if os != val:
        return False

    # This should generate an error because this expression will always
    # evaluate to False.
    if val == 2:
        return False

    if val == 1:
        return True


class ClassA: ...


class ClassB: ...


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound=ClassB)


def func2(a: ClassA, b: ClassB, c: _T1, d: _T2, e: ClassA | ClassB) -> None | _T1 | _T2:
    # This should generate an error because there is no overlap in types.
    if a == b:
        return

    # This should generate an error because there is no overlap in types.
    if a != b:
        return

    if a != c:
        return

    # This should generate an error because there is no overlap in types.
    if a != d:
        return

    if a == e:
        return

    if b == e:
        return


def func3(base: type) -> None:
    if base == ClassA:
        ...

    if ClassA == base:
        ...


def func4(val: str | None):
    # This should generate an error because there is no overlap in types.
    if val == 42:
        ...
