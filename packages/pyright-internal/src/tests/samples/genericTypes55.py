# This sample tests the case where the return type of a function is
# a generic Callable that can be specialized with type variables
# provided by the caller.

from typing import Callable, Literal, TypeVar

_T = TypeVar("_T")


def identity_generic(x: _T) -> _T:
    return x


def identity_callable_1(x: Callable[[_T], _T]) -> Callable[[_T], _T]:
    return x


MyCallable = Callable[[_T], _T]


def identity_callable_2(x: MyCallable[_T]) -> MyCallable[_T]:
    return x


def identity_int(x: int) -> int:
    return x


v1 = identity_callable_1(identity_int)
t_v1_1: Literal["(int) -> int"] = reveal_type(v1)
t_v1_2: Literal["int"] = reveal_type(v1(0))

v2 = identity_callable_1(identity_generic)
t_v2_1: Literal["(_T@identity_generic) -> _T@identity_generic"] = reveal_type(v2)
t_v2_2: Literal["int"] = reveal_type(v2(0))
t_v2_3: Literal["str"] = reveal_type(v2(""))

v3 = identity_callable_2(identity_int)
t_v3_1: Literal["(int) -> int"] = reveal_type(v3)
t_v3_2: Literal["int"] = reveal_type(v3(0))

v4 = identity_callable_2(identity_generic)
t_v4_1: Literal["(_T@identity_generic) -> _T@identity_generic"] = reveal_type(v4)
t_v4_2: Literal["int"] = reveal_type(v4(0))
t_v4_3: Literal["str"] = reveal_type(v4(""))
