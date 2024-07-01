# This sample tests that the assignment of an instantiable generic class
# without supplied type arguments is given default type arguments (typically
# Unknown) when the TypeVar is solved.

from typing import Any, Callable, Generic, Iterable, TypeVar, reveal_type

T = TypeVar("T")


def deco1(t: type[T], val: Any) -> T:
    return val


v1 = deco1(dict, {"foo": "bar"})
reveal_type(v1, expected_text="dict[Unknown, Unknown]")


def deco2(t: T, val: Any) -> T:
    return val


v2 = deco2(dict, {"foo": "bar"})
reveal_type(v2, expected_text="type[dict[Unknown, Unknown]]")


def deco3(t: type[T]) -> type[T]:
    return t


@deco3
class ClassA(Generic[T]):
    pass


reveal_type(ClassA[int], expected_text="type[ClassA[int]]")


def deco4() -> Callable[[type[T]], type[T]]: ...


@deco4()
class ClassB:
    def get_features(self) -> list[str]: ...


def func1(specs: Iterable[str] | ClassB) -> None:
    if isinstance(specs, ClassB):
        features = specs.get_features()
    else:
        features = specs

    set(features)
