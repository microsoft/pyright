# This sample tests the handling of variadic type variables used
# within Callable types.

# pyright: reportMissingModuleSource=false

from typing import Any, Callable, Literal, Protocol, Union
from typing_extensions import TypeVarTuple, Unpack

_Xs = TypeVarTuple("_Xs")


def func1(func: Callable[[int, Unpack[_Xs]], Any]) -> Callable[[Unpack[_Xs]], int]:
    ...


def func2(func: Callable[[Unpack[_Xs]], int]) -> Callable[[Unpack[_Xs]], int]:
    ...


def callback1(a: int) -> int:
    ...


def callback2(a: str) -> int:
    ...


def callback3(a: str) -> None:
    ...


def callback4(a: int, b: complex, c: str) -> int:
    ...


def callback5(a: int, *args: Unpack[_Xs]) -> Union[Unpack[_Xs]]:
    ...


def callback6(a: int, *args: Any) -> int:
    ...


def callback7(a: int, b: str, c: str, d: str, *args: Any) -> int:
    ...


c1 = func1(callback1)
t_c1: Literal["() -> int"] = reveal_type(c1)
c1_1 = c1()
t_c1_1: Literal["int"] = reveal_type(c1_1)

# This should generate an error.
c2 = func1(callback2)

# This should generate an error.
c3 = func2(callback3)

c4 = func1(callback4)
t_c4: Literal["(_p0: complex, _p1: str) -> int"] = reveal_type(c4)
c4_1 = c4(3j, "hi")
t_c4_1: Literal["int"] = reveal_type(c4_1)

# This should generate an error.
c4_2 = c4(3j)

# This should generate an error.
c4_3 = c4(3j, "hi", 4)

c5 = func1(callback5)
t_c5: Literal["(_p0: *_Xs@callback5) -> int"] = reveal_type(c5)

# This should generate an error.
c6_1 = func1(callback6)

# This should generate an error.
c6_2 = func2(callback6)

# This should generate an error.
c7_1 = func1(callback7)

# This should generate an error.
c7_2 = func2(callback7)


class CallbackA(Protocol[Unpack[_Xs]]):
    def __call__(self, a: int, *args: Unpack[_Xs]) -> Any:
        ...


def func3(func: CallbackA[Unpack[_Xs]]) -> Callable[[Unpack[_Xs]], int]:
    ...


d1 = func3(callback1)
t_d1: Literal["() -> int"] = reveal_type(d1)

# This should generate an error.
d2 = func3(callback2)

# This should generate an error.
d3 = func3(callback3)

d4 = func3(callback4)
t_d4: Literal["(_p0: complex, _p1: str) -> int"] = reveal_type(d4)
d4_1 = d4(3j, "hi")
t_d4_1: Literal["int"] = reveal_type(d4_1)

# This should generate an error.
d4_2 = d4(3j)

# This should generate an error.
d4_3 = d4(3j, "hi", 4)


def func4(func: Callable[[Unpack[_Xs], int], int]) -> Callable[[Unpack[_Xs]], int]:
    ...


def callback8(a: int, b: str, c: complex, d: int) -> int:
    ...


d5_1 = func4(callback1)
t_d5_1: Literal["() -> int"] = reveal_type(d5_1)

# This should generate an error.
d5_2 = func4(callback4)

d5_3 = func4(callback8)
t_d5_3: Literal["(_p0: int, _p1: str, _p2: complex) -> int"] = reveal_type(d5_3)
