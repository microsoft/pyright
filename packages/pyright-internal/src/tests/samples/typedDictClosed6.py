# This sample tests type compatibility between closed TypedDicts and
# dict and MutableMapping types.

from typing import MutableMapping, NotRequired, TypedDict
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]


class IntDict1(TypedDict, extra_items=int):
    pass


class IntDictWithNum(IntDict1):
    num: NotRequired[int]


def func1(x: IntDict1) -> None:
    v: dict[str, int] = x
    v.clear()


def func2(x: dict[str, int]):
    # This should generate an error.
    not_required_num: IntDictWithNum = x


def func3(p1: IntDictWithNum, p2: dict[str, int]):
    d1: dict[str, int] = p1
    m1: MutableMapping[str, int] = p1
    func1(p1)

    # This should generate an error.
    d2: IntDictWithNum = p2


class IntDict2(TypedDict, extra_items=int):
    num: int


def func4(p1: IntDict2):
    # This should generate an error.
    d1: dict[str, int] = p1

    # This should generate an error.
    m1: MutableMapping[str, int] = p1

    # This should generate an error.
    func1(p1)


class IntDict3(TypedDict, extra_items=int):
    num: NotRequired[ReadOnly[int]]


def func5(p1: IntDict3):
    # This should generate an error.
    d1: dict[str, int] = p1

    # This should generate an error.
    m1: MutableMapping[str, int] = p1

    # This should generate an error.
    func1(p1)
