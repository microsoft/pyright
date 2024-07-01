# This sample tests the case where the return type of a function is
# a generic Callable that can be specialized with type variables
# provided by the caller.

from typing import Callable, List, TypeVar, Union

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
reveal_type(v1, expected_text="(int) -> int")
reveal_type(v1(0), expected_text="int")

v2 = identity_callable_1(identity_generic)
reveal_type(v2, expected_text="(_T@identity_generic) -> _T@identity_generic")
reveal_type(v2(0), expected_text="int")
reveal_type(v2(""), expected_text="str")

v3 = identity_callable_2(identity_int)
reveal_type(v3, expected_text="(int) -> int")
reveal_type(v3(0), expected_text="int")

v4 = identity_callable_2(identity_generic)
reveal_type(v4, expected_text="(_T@identity_generic) -> _T@identity_generic")
reveal_type(v4(0), expected_text="int")
reveal_type(v4(""), expected_text="str")


_U = TypeVar("_U")


def dec() -> Callable[[_U], _U]: ...


@dec()
def func1(x: _T, y: Union[_T, List[_T]]) -> None:
    pass


func1(1, 2)
func1(1, [2, 3])
