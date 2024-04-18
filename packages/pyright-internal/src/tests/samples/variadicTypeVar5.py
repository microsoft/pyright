# This sample tests the handling of variadic type variables used
# within Callable types.

from typing import Any, Callable, Protocol
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)

_Xs = TypeVarTuple("_Xs")


def func1(func: Callable[[int, Unpack[_Xs]], Any]) -> Callable[[Unpack[_Xs]], int]: ...


def func2(func: Callable[[Unpack[_Xs]], int]) -> Callable[[Unpack[_Xs]], int]: ...


def callback1(a: int) -> int: ...


def callback2(a: str) -> int: ...


def callback3(a: str) -> None: ...


def callback4(a: int, b: complex, c: str) -> int: ...


def callback5(a: int, *args: Unpack[_Xs]) -> tuple[Unpack[_Xs]]: ...


def callback6(a: int, *args: Any) -> int: ...


def callback7(a: int, b: str, c: str, d: str, *args: Any) -> int: ...


c1 = func1(callback1)
reveal_type(c1, expected_text="() -> int")
c1_1 = c1()
reveal_type(c1_1, expected_text="int")

# This should generate an error.
c2 = func1(callback2)

# This should generate an error.
c3 = func2(callback3)

c4 = func1(callback4)
reveal_type(c4, expected_text="(complex, str) -> int")
c4_1 = c4(3j, "hi")
reveal_type(c4_1, expected_text="int")

# This should generate an error.
c4_2 = c4(3j)

# This should generate an error.
c4_3 = c4(3j, "hi", 4)

c5 = func1(callback5)
reveal_type(c5, expected_text="(*_Xs@callback5) -> int")

c6_1 = func1(callback6)
reveal_type(c6_1, expected_text="(*Any) -> int")

c6_2 = func2(callback6)
reveal_type(c6_2, expected_text="(int, *Any) -> int")

c7_1 = func1(callback7)
reveal_type(c7_1, expected_text="(str, str, str, *Any) -> int")

c7_2 = func2(callback7)
reveal_type(c7_2, expected_text="(int, str, str, str, *Any) -> int")


class CallbackA(Protocol[Unpack[_Xs]]):
    def __call__(self, a: int, *args: Unpack[_Xs]) -> Any: ...


def func3(func: CallbackA[Unpack[_Xs]]) -> Callable[[Unpack[_Xs]], int]: ...


d1 = func3(callback1)
reveal_type(d1, expected_text="() -> int")

# This should generate an error.
d2 = func3(callback2)

# This should generate an error.
d3 = func3(callback3)

d4 = func3(callback4)
reveal_type(d4, expected_text="(complex, str) -> int")
d4_1 = d4(3j, "hi")
reveal_type(d4_1, expected_text="int")

# This should generate an error.
d4_2 = d4(3j)

# This should generate an error.
d4_3 = d4(3j, "hi", 4)


def func4(func: Callable[[Unpack[_Xs], int], int]) -> Callable[[Unpack[_Xs]], int]: ...


def callback8(a: int, b: str, c: complex, d: int) -> int: ...


d5_1 = func4(callback1)
reveal_type(d5_1, expected_text="() -> int")

# This should generate an error.
d5_2 = func4(callback4)

d5_3 = func4(callback8)
reveal_type(d5_3, expected_text="(int, str, complex) -> int")


def func5(x: Callable[[Unpack[_Xs]], None], y: tuple[Unpack[_Xs]]):
    pass


def func6(x: Callable[[Unpack[_Xs]], None], y: tuple[Unpack[_Xs]]):
    func5(x, y)
