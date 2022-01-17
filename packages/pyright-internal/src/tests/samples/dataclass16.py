# This sample verifies that a generic dataclass works.

from dataclasses import dataclass
from typing import Generic, TypeVar, Union

T = TypeVar("T")


@dataclass
class Foo(Generic[T]):
    value: Union[str, T]


reveal_type(Foo(""), expected_text="Foo[str]")


class Bar(Foo[int]):
    pass


reveal_type(Bar(123), expected_text="Bar")
