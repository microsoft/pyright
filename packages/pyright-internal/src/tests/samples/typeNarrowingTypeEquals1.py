# This sample exercises the type analyzer's type narrowing
# logic for tests of the form "type(X) == Y" or "type(X) != Y".

from typing import Any, Generic, TypeVar, final


def func1(a: str | int) -> int:
    if type(a) != str:
        # This should generate an error because
        # "a" is potentially a subclass of str.
        return a

    # This should generate an error because
    # "a" is provably type str at this point.
    return a


def func2(a: str | None) -> str:
    if type(a) == str:
        return a

    # This should generate an error because
    # "a" is provably type str at this point.
    return a


def func3(a: dict[str, Any]) -> str:
    val = a.get("hello")
    if type(val) == str:
        return val

    return "none"


class A:
    pass


class B(A):
    pass


def func4(a: str | A):
    if type(a) == B:
        reveal_type(a, expected_text="B")
    else:
        reveal_type(a, expected_text="str | A")


T = TypeVar("T")


class C(Generic[T]):
    def __init__(self, a: T):
        self.a = a


class D:
    pass


E = C[T] | D


def func5(x: E[T]) -> None:
    if type(x) == C:
        reveal_type(x, expected_text="C[T@func5]")


@final
class AFinal:
    pass


@final
class BFinal:
    pass


def func6(val: AFinal | BFinal) -> None:
    if type(val) == AFinal:
        reveal_type(val, expected_text="AFinal")
    else:
        reveal_type(val, expected_text="BFinal")


def func7(val: Any):
    if type(val) == int:
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="Any")

    reveal_type(val, expected_text="int | Any")


class CParent: ...


class CChild(CParent): ...


_TC = TypeVar("_TC", bound=CParent)


def func8(a: _TC, b: _TC) -> _TC:
    if type(a) == CChild:
        reveal_type(a, expected_text="CChild*")
        return a
    reveal_type(a, expected_text="CParent*")
    return a
