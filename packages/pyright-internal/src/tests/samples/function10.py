# This sample tests bidirectional type inference for a function when
# a union includes a "bare" TypeVar and another (non-generic) type.

from dataclasses import dataclass
from typing import Generic, Sequence, TypeVar, Union

T = TypeVar("T")


@dataclass
class Container(Generic[T]):
    values: Sequence[Union[float, T]]


def create_container(values: Sequence[Union[float, T]]) -> Container[T]:
    return Container(values)


arg: Sequence[Union[float, int]] = (1, 2.0)
x: Container[int] = create_container(arg)
