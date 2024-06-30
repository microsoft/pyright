# This sample tests a member access when the metaclass implements a descriptor
# protocol.

from typing import Any, TypeVar, overload


T = TypeVar("T")


class MetaClass(type):
    @overload
    def __get__(self: type[T], instance: None, owner: Any) -> type[T]: ...

    @overload
    def __get__(self: type[T], instance: object, owner: Any) -> T: ...

    def __get__(self: type[T], instance: object | None, owner: Any) -> type[T] | T:
        if instance is None:
            return self
        return self()


class A(metaclass=MetaClass): ...


class B:
    a = A


reveal_type(B.a, expected_text="type[A]")
reveal_type(B().a, expected_text="A")
