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


def func5(data1: bytearray, data2: bytes):
    # "bytearray" and "bytes" are disjoint types, but they should still be
    # considered comparable because their "__eq__" methods support
    # cross-type content comparisons.
    if data1 == data2:
        ...

    if data1 == b"\x00\x00\x00\x00":
        ...


def func6(x: int, y: str):
    # This should generate an error because there is no overlap in types.
    if x == y:
        ...


def func7(x: list[int], y: dict[str, int]):
    # This should generate an error because there is no overlap in types.
    if x == y:
        ...


def func8(a: memoryview, b: bytes, c: bytearray):
    # "memoryview", "bytes" and "bytearray" are all mutually comparable
    # for the same reason as func5, above.
    if a == b:
        ...

    if a == c:
        ...

    if b == c:
        ...
