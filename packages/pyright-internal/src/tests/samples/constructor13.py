# This sample tests the case where a generic type Type[T] is
# instantiated.

from typing import Generic, TypeVar

T = TypeVar("T")


class Foo(Generic[T]):
    def __init__(self) -> None:
        val = self.method1()
        reveal_type(val(), expected_text="T@Foo")

        # This should generate an error.
        val(1)

    def method1(self) -> type[T]: ...
