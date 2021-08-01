# This sample exercises the type analyzer's type narrowing
# logic for tests of the form "type(X) is Y" or "type(X) is not Y".

from typing import Any, Dict, Generic, Literal, Optional, TypeVar, Union, final


def func1(a: Union[str, int]) -> int:

    if type(a) is not str:
        # This should generate an error because
        # "a" is potentially a subclass of str.
        return a

    # This should generate an error because
    # "a" is provably type str at this point.
    return a


def func2(a: Optional[str]) -> str:

    if type(a) is str:
        return a

    # This should generate an error because
    # "a" is provably type str at this point.
    return a


def func3(a: Dict[str, Any]) -> str:
    val = a.get("hello")
    if type(val) is str:
        return val

    return "none"


class A:
    pass


class B(A):
    pass


def func4(a: Union[str, A]):
    if type(a) is B:
        t1: Literal["B"] = reveal_type(a)
    else:
        t2: Literal["str | A"] = reveal_type(a)


T = TypeVar("T")


class C(Generic[T]):
    def __init__(self, a: T):
        self.a = a


class D:
    pass


E = Union[C[T], D]


def func5(x: E[T]) -> None:
    if type(x) is C:
        t1: Literal["C[T@func5]"] = reveal_type(x)


@final
class AFinal:
    pass


@final
class BFinal:
    pass


def foo(c: Union[AFinal, BFinal]) -> None:
    if type(c) is AFinal:
        t1: Literal["AFinal"] = reveal_type(c)
    else:
        t2: Literal["BFinal"] = reveal_type(c)
