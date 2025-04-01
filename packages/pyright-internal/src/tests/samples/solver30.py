# This sample tests the case where a deeply nested set of calls requires
# the use of bidirectional type inference to evaluate the type of a lambda.

from typing import Any, Callable, Iterable, Iterator, Protocol, TypeVar

X = TypeVar("X")
Y = TypeVar("Y")
Z = TypeVar("Z")


class Item:
    foo: bool


items = [Item()]


def func1(a: Iterable[X]) -> X: ...


def func2(a: Iterable[Y]) -> Iterable[Y]: ...


class func3(Iterator[Z]):
    def __init__(self, a: Callable[[Z], Any], b: Iterable[Z]) -> None: ...

    def __next__(self) -> Z: ...


def func4(a: Callable[[Z], Any], b: Iterable[Z]) -> Iterator[Z]: ...


func1(func2(func3(lambda x: reveal_type(x.foo, expected_text="bool"), items)))

func1(func2(func4(lambda x: reveal_type(x.foo, expected_text="bool"), items)))
