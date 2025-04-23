# This sample exercises the type analyzer's type narrowing
# logic for tests of the form "type(X) is Y" or "type(X) is not Y".

from typing import Any, Generic, TypeVar, final


def func1(a: str | int) -> int:
    if type(a) is not str:
        # This should generate an error because
        # "a" is potentially a subclass of str.
        return a

    # This should generate an error because
    # "a" is provably type str at this point.
    return a


def func2(a: str | None) -> str:
    if type(a) is str:
        return a

    # This should generate an error because
    # "a" is provably type str at this point.
    return a


def func3(a: dict[str, Any]) -> str:
    val = a.get("hello")
    if type(val) is str:
        return val

    return "none"


class A:
    pass


class B(A):
    pass


def func4(a: str | A):
    if type(a) is B:
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
    if type(x) is C:
        reveal_type(x, expected_text="C[T@func5]")


@final
class AFinal:
    pass


@final
class BFinal:
    pass


def func6(val: AFinal | BFinal) -> None:
    if type(val) is AFinal:
        reveal_type(val, expected_text="AFinal")
    else:
        reveal_type(val, expected_text="BFinal")


def func7(val: Any):
    if type(val) is int:
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="Any")

    reveal_type(val, expected_text="int | Any")


class CParent: ...


class CChild(CParent): ...


_TC = TypeVar("_TC", bound=CParent)


def func8(a: _TC, b: _TC) -> _TC:
    if type(a) is CChild:
        reveal_type(a, expected_text="CChild*")
        return a
    reveal_type(a, expected_text="CParent*")
    return a


class F:
    def method1(self, v: object):
        if type(self) == type(v):
            reveal_type(self, expected_text="Self@F")
        else:
            reveal_type(self, expected_text="Self@F")


class G(str):
    @classmethod
    def method1(cls, v: str):
        if type(v) is cls:
            reveal_type(v, expected_text="G*")
        else:
            reveal_type(v, expected_text="str")


class H:
    def __init__(self, x): ...


def func9[T: H](x: type[T], y: H) -> T:
    if type(y) == x:
        reveal_type(y, expected_text="H*")
        return y
    return x(y)


class I:
    pass


class J:
    pass


def func10[T: I | J](items: list[I | J], kind: type[T]) -> T | None:
    for i in items:
        if type(i) is kind:
            reveal_type(i, expected_text="I* | J*")
            return i
