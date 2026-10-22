# This sample tests that only generated NamedTuple methods are exempt from variance inference.

from typing import Callable


type Sink[*Ts] = Callable[[*Ts], None]


class Consumer[T]:
    _replace: Sink[T]


class OtherConsumer[T]:
    _consume: Sink[T]


def func1(value: Consumer[int]) -> Consumer[object]:
    # This should generate an error.
    return value


def func2(value: Consumer[object]) -> Consumer[int]:
    return value


def func3(value: OtherConsumer[int]) -> OtherConsumer[object]:
    # This should generate an error.
    return value


def func4(value: OtherConsumer[object]) -> OtherConsumer[int]:
    return value


def func5(value: Consumer[int], other: OtherConsumer[int]):
    reveal_type(value._replace, expected_text="(int) -> None")
    reveal_type(other._consume, expected_text="(int) -> None")
