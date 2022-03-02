# This sample tests the case where a constrained TypeVar is used
# as an argument for a constructor or function call.

from typing import TypeVar, Generic, Union
from dataclasses import dataclass


class NDArray:
    ...


_T = TypeVar("_T", Union[int, float], NDArray)


@dataclass
class Data(Generic[_T]):
    data: _T


def func1(a: Data[_T]) -> _T:
    if isinstance(a.data, (int, float)):
        value = int(a.data / 3)
        reveal_type(value, expected_text="int*")
    else:
        value = a.data
        reveal_type(value, expected_text="NDArray*")

    return value
