# This sample tests type compatibility between closed TypedDicts and
# dict and MutableMapping types.

from typing import MutableMapping, NotRequired, TypedDict
from typing_extensions import ReadOnly


class IntDict1(TypedDict, closed=True):
    __extra_items__: int


class IntDictWithNum(IntDict1):
    num: NotRequired[int]


def func1(x: IntDict1) -> None:
    v: dict[str, int] = x
    v.clear()


def func2(x: dict[str, int]):
    not_required_num: IntDictWithNum = x


def func3(p1: IntDictWithNum):
    d1: dict[str, int] = p1
    m1: MutableMapping[str, int] = p1
    func1(p1)


class IntDict2(TypedDict, closed=True):
    num: int
    __extra_items__: int


def func4(p1: IntDict2):
    # This should generate an error.
    d1: dict[str, int] = p1

    # This should generate an error.
    m1: MutableMapping[str, int] = p1

    # This should generate an error.
    func1(p1)


class IntDict3(TypedDict, closed=True):
    num: NotRequired[ReadOnly[int]]
    __extra_items__: int


def func5(p1: IntDict3):
    # This should generate an error.
    d1: dict[str, int] = p1

    # This should generate an error.
    m1: MutableMapping[str, int] = p1

    # This should generate an error.
    func1(p1)
