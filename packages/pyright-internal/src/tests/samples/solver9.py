# This sample tests that Optional types can be matched
# to Type[T] expressions by the constraint solver.

from typing import Callable, Generic, Optional, TypeVar

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound=None)
_T3 = TypeVar("_T3")


def func1(a: type[_T1]) -> _T1:
    return a()


a = func1(int)


def func2(a: type[_T2]) -> type[_T2]:
    return a


b = func2(type(None))

# This should generate an error because None is
# not a type; it's an instance of the NoneType class.
c = func2(None)


class ClassA(Generic[_T1]):
    def __init__(self, value: _T1) -> None: ...

    @classmethod
    def get(cls: type[_T3]) -> type[_T3]:
        return cls


class ClassB(ClassA):
    pass


def func3(value: _T1) -> type[ClassA[_T1]]:
    v1 = ClassA(value)
    v2 = type(v1)
    reveal_type(v2, expected_text="type[ClassA[_T1@func3]]")
    return v2


d = ClassB.get()
reveal_type(d, expected_text="type[ClassB]")
reveal_type(ClassB.get(), expected_text="type[ClassB]")


def func4(cls: type[_T1]) -> Callable[..., _T1]:
    return cls
