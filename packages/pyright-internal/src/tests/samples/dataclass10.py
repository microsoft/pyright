# This sample verifies that a generic dataclass works.

from dataclasses import dataclass
from typing import Generic, TypeVar, Union

T = TypeVar("T")


@dataclass
class ABase(Generic[T]):
    value: Union[str, T]


reveal_type(ABase(""), expected_text="ABase[Unknown]")


class AChild(ABase[int]):
    pass


reveal_type(AChild(123), expected_text="AChild")


class B(Generic[T]):
    pass


@dataclass
class CBase(Generic[T]):
    x: B[T] = B[T]()


@dataclass
class CChild(CBase[T]):
    pass


c1 = CBase[int]()
reveal_type(c1, expected_text="CBase[int]")
reveal_type(c1.x, expected_text="B[int]")

c2 = CChild[int]()
reveal_type(c2, expected_text="CChild[int]")
reveal_type(c2.x, expected_text="B[int]")
