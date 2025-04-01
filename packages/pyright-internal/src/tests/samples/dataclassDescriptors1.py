# This sample tests the handling of dataclass fields that use
# descriptor objects.

from dataclasses import dataclass
from typing import Any, cast, overload


class MyDescriptor:
    @overload
    def __get__(self, __obj: None, __owner: Any) -> "MyDescriptor": ...

    @overload
    def __get__(self, __obj: object, __owner: Any) -> int: ...

    def __get__(self, __obj: object | None, __owner: Any) -> "int | MyDescriptor":
        if __obj is None:
            return self
        return cast(Any, __obj)._x

    def __set__(self, __obj: object, __value: int) -> None:
        if __obj is not None:
            cast(Any, __obj)._x = __value


@dataclass
class Foo:
    y: MyDescriptor = MyDescriptor()


f1 = Foo(3)

reveal_type(f1.y, expected_text="int")
reveal_type(Foo.y, expected_text="MyDescriptor")


# This should generate an error.
f2 = Foo("hi")


f3 = Foo()
reveal_type(f3.y, expected_text="int")
