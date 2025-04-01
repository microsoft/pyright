# This sample tests the case where a constrained TypeVar is used
# as an argument for a constructor or function call.

from typing import AnyStr, Iterable, TypeVar, Generic
from dataclasses import dataclass


class ClassA: ...


_T = TypeVar("_T", int | float, ClassA)


@dataclass
class Data(Generic[_T]):
    data: _T


def func1(a: Data[_T]) -> _T:
    if isinstance(a.data, (int, float)):
        value = int(a.data / 3)
        reveal_type(value, expected_text="int*")
    else:
        value = a.data
        reveal_type(value, expected_text="ClassA*")

    return value


def func2(val: AnyStr, objs: Iterable[AnyStr]) -> AnyStr:
    return val.join(objs)
