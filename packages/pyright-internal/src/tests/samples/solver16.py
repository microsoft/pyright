# This sample tests the case where a TypeVar is used in the parameter
# of a callable (and is hence treated as contravariant).

from typing import Callable, Sequence, TypeVar

T = TypeVar("T")
U = TypeVar("U")


def func1(value: T) -> T: ...


def func2(values: Sequence[T]) -> T: ...


def func3(value: T, callback: Callable[[T], U]) -> U: ...


def func4(values: Sequence[T], callback: Callable[[Sequence[T]], U]) -> U: ...


reveal_type(func3(1.0, func1), expected_text="float")
reveal_type(func4([1.0], func1), expected_text="Sequence[float]")
reveal_type(func4([1.0], func2), expected_text="float")


def func5(obj: object, cb: Callable[[], Callable[[T], object]]) -> None:
    # This should generate an error.
    cb()(obj)
