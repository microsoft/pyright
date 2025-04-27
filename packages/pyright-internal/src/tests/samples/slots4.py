# This sample tests the case where a descriptor is assigned to an
# instance variable that is included in __slots__.

from typing import Self, overload


class A:
    pass


class Descriptor:
    name: str

    @overload
    def __get__(self, obj: None, objtype: type[A] | None = None) -> Self: ...

    @overload
    def __get__(self, obj: A, objtype: type[A] | None = None) -> int: ...

    def __get__(self, obj: A | None, objtype: type[A] | None = None) -> Self | int: ...

    def __set__(self, obj: A, value: int): ...


class B:
    __slots__ = "descriptor"

    def __init__(self, descriptor: Descriptor):
        self.descriptor = descriptor


v1 = B(descriptor=Descriptor())
reveal_type(v1.descriptor.name, expected_text="str")
