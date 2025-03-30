# This sample tests the case where a constrained TypeVar is assigned
# to another constrained TypeVar or a union that contains a constrained
# TypeVar.

from os import PathLike
from typing import AnyStr


def func1(path: AnyStr | PathLike[AnyStr]) -> AnyStr: ...


def func2(value: AnyStr) -> AnyStr:
    return func1(value)
