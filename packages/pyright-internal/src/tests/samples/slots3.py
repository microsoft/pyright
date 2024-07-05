# This sample tests the case where a descriptor is assigned to a
# class variable but not included in __slots__.

from typing import Any


class MyDescriptor:
    def __init__(self, *, slot: str): ...

    def __set__(self, instance: object, value: object) -> None: ...

    def __get__(self, instance: object, owner: Any) -> Any: ...


class ClassA:
    foo = MyDescriptor(slot="_foo_descriptor")
    __slots__ = "_foo_descriptor"

    def __init__(self, foo: int) -> None:
        self.foo = foo


class ClassBParent:
    __slots__ = ("bar1",)
    foo = MyDescriptor(slot="_foo_descriptor")


class ClassB(ClassBParent):
    __slots__ = ("bar2",)

    def repro(self, foo: int) -> None:
        self.foo = foo
