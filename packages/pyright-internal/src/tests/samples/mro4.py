# This sample tests the special-case handling of Generic in a class
# hierarchy. The Generic class implementation in CPython has a method
# called __mro_entries__ that elides the Generic base class in cases
# where one or more subsequent base classes are specialized generic classes.

from typing import Generic, TypeVar

T1 = TypeVar("T1")
T2 = TypeVar("T2")


class Foo1(Generic[T1]): ...


class Foo2(Generic[T1]): ...


class Bar1(Generic[T1, T2], Foo1[T1], Foo2[T2]): ...


class Bar2(Generic[T1, T2], Foo1, Foo2[T2]): ...


# This should generate an error because a consistent MRO cannot be found.
class Bar3(Generic[T1, T2], Foo1, Foo2): ...
