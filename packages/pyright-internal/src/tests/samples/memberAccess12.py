# This sample tests a member access when the metaclass implements a descriptor
# protocol.

from typing import Any, Literal, Optional, Union, Type, TypeVar, overload


T = TypeVar("T")


class MetaClass(type):
    @overload
    def __get__(self: Type[T], instance: None, owner: Any) -> Type[T]:
        ...

    @overload
    def __get__(self: Type[T], instance: object, owner: Any) -> T:
        ...

    def __get__(
        self: Type[T], instance: Optional[object], owner: Any
    ) -> Union[Type[T], T]:
        if instance is None:
            return self
        return self()


class A(metaclass=MetaClass):
    ...


class B:
    a = A


t1: Literal["Type[A]"] = reveal_type(B.a)
t2: Literal["A"] = reveal_type(B().a)
