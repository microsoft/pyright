# This sample tests the handling of recursive type aliases that are generic.

from __future__ import annotations
from typing import Mapping, Sequence, TypeVar, Union

S = TypeVar("S")
RecList = Union[Mapping[str, "RecList[S]"], Sequence["RecList[S]"], S]

T3 = TypeVar("T3", RecList[int], RecList[str])


def f3(x: RecList[int] | RecList[str]) -> None: ...


def g3(x: T3):
    return f3(x)


def f4(x: RecList[str] | RecList[int]) -> None: ...


def g4(x: T3):
    return f4(x)
