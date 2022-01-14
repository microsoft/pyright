# This sample tests the use of `Self` when used within a property
# or class property.

from typing import Literal
from typing_extensions import Self


class A:
    @property
    def one(self) -> Self:
        ...

    @classmethod
    @property
    def two(cls) -> type[Self]:
        ...


class B(A):
    ...


t1: Literal["A"] = reveal_type(A().one)
t2: Literal["Type[A]"] = reveal_type(A.two)

t3: Literal["B"] = reveal_type(B().one)
t4: Literal["Type[B]"] = reveal_type(B.two)
