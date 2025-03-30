# This sample tests the case where a callback protocol uses a default argument
# but the corresponding callable does not or vice versa.

from typing import Protocol


# Callback with positional parameter with default arg value.
class Callback1(Protocol):
    def __call__(self, path: str = ...) -> str: ...


# Callback with positional parameter without default arg value.
class Callback2(Protocol):
    def __call__(self, path: str) -> str: ...


def func1_1(path: str = "") -> str: ...


def func1_2(path: str) -> str: ...


val1_1: Callback1 = func1_1

# This should generate an error.
val1_2: Callback1 = func1_2

val2_1: Callback2 = func1_1

val2_2: Callback2 = func1_2


# Callback with keyword parameter with default arg value.
class Callback3(Protocol):
    def __call__(self, *, path: str = ...) -> str: ...


# Callback with keyword parameter without default arg value.
class Callback4(Protocol):
    def __call__(self, *, path: str) -> str: ...


def func3_1(*, path: str = "") -> str: ...


def func3_2(*, path: str) -> str: ...


val3_1: Callback3 = func3_1

# This should generate an error.
val3_2: Callback3 = func3_2

val4_1: Callback4 = func3_1

val4_2: Callback4 = func3_2
