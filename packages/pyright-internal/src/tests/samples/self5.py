# This sample tests the use of `Self` when used within a property
# or class property.

from typing_extensions import Self  # pyright: ignore[reportMissingModuleSource]


class A:
    @property
    def one(self) -> Self: ...

    @classmethod
    @property
    def two(cls) -> type[Self]: ...


class B(A): ...


reveal_type(A().one, expected_text="A")
reveal_type(A.two, expected_text="type[A]")

reveal_type(B().one, expected_text="B")
reveal_type(B.two, expected_text="type[B]")
