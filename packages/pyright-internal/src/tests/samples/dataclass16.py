# This sample verifies that a generic dataclass works.

from dataclasses import dataclass
from typing import Generic, Literal, TypeVar, Union

T = TypeVar("T")


@dataclass
class Foo(Generic[T]):
    value: Union[str, T]


t1: Literal["Foo[str]"] = reveal_type(Foo(""))


class Bar(Foo[int]):
    pass


t2: Literal["Bar"] = reveal_type(Bar(123))
