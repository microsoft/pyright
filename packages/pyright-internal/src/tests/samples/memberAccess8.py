# This sample tests the use of a generic descriptor class.

from typing import Any, Callable, Generic, TypeVar, overload


_T = TypeVar("_T")
_T_co = TypeVar("_T_co", covariant=True)


class Column(Generic[_T]):
    def __get__(self, instance: object, type: Any) -> _T: ...

    def __set__(self, instance: object, value: _T) -> _T: ...

    def __delete__(self, instance: object) -> None: ...


class Foo:
    bar: Column[str] = Column()
    baz: Column[list[int]] = Column()


foo = Foo()

v1 = foo.bar
reveal_type(v1, expected_text="str")

foo.bar = ""
del foo.bar


v2 = foo.baz
reveal_type(v2, expected_text="list[int]")

foo.baz = [1]
del foo.baz


class Minimal(Generic[_T, _T_co]):
    def __init__(self, name: str, func: Callable[[_T], _T_co]): ...

    @overload
    def __get__(self, instance: None, owner: type[_T]) -> "Minimal[_T, _T_co]": ...

    @overload
    def __get__(self, instance: _T, owner: type[_T]) -> _T_co: ...

    def __get__(self, instance: _T | None, owner: type[_T]) -> Any: ...


def minimal_property(
    name: str,
) -> Callable[[Callable[[_T], _T_co]], Minimal[_T, _T_co]]:
    def decorator(func: Callable[[_T], _T_co]) -> Minimal[_T, _T_co]:
        return Minimal(name, func)

    return decorator


class B:
    @minimal_property("foo")
    def foo(self) -> str:
        return "hello"


b = B()
reveal_type(b.foo, expected_text="str")
reveal_type(B.foo, expected_text="Minimal[B, str]")
