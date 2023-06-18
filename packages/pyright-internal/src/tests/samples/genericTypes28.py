# This sample tests that Optional types can be matched
# to Type[T] expressions.

from typing import Callable, Generic, Optional, Type, TypeVar

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound=None)
_T3 = TypeVar("_T3")


def foo1(a: Type[_T1]) -> _T1:
    return a()


a = foo1(Optional[int])


def foo2(a: Type[_T2]) -> Type[_T2]:
    return a


b = foo2(type(None))

# This should generate an error because None is
# not a type; it's an instance of the NoneType class.
c = foo2(None)


class Foo(Generic[_T1]):
    def __init__(self, value: _T1) -> None:
        ...

    @classmethod
    def get(cls: Type[_T3]) -> Type[_T3]:
        return cls


class Bar(Foo):
    pass


def bar(value: _T1) -> Type[Foo[_T1]]:
    baz = Foo(value)
    qux = type(baz)
    reveal_type(qux, expected_text="type[Foo[_T1@bar]]")
    return qux


d = Bar.get()
reveal_type(d, expected_text="type[Bar]")
reveal_type(Bar.get(), expected_text="type[Bar]")


def class_constructor(cls: type[_T1]) -> Callable[..., _T1]:
    return cls
