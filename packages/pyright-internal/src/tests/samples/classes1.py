# This sample tests the type checker's ability to
# handle various class definition cases.


from typing import Any, Self, TypeVar, Union


T = TypeVar("T")
T2 = TypeVar("T2", bound=type[Any])


class A:
    ...


class B:
    C: type[A]


app = B()


class D(app.C):
    ...


class EMeta(type):
    def __new__(mcls, *args: Any, **kwargs: Any):
        ...


class E(metaclass=EMeta):
    pass


class F(E):
    pass


class G[T](E, metaclass=type):
    def my_method(self) -> "G":
        reveal_type(__class__, expected_text="type[G[Unknown]]")
        return __class__()


# This should generate an error because only one metaclass is supported.
class H(E, metaclass=type, metaclass=type):
    pass


class I(E, other_keyword=2):
    pass


args = [1, 2, 3]
kwargs = {"foo": 5}


class J(*args, **kwargs):
    pass


def func1(x: type) -> object:
    class Y(x):
        pass

    return Y()


def func4(t1: type | type[Any], t2: type[A] | Any):
    class N1(t1):
        pass

    reveal_type(N1().x, expected_text="Unknown")

    class N2(t2):
        pass

    reveal_type(N2().x, expected_text="Any")


def func5(t1: type[A] | type[B], t2: int | Any):
    # This should generate an error.
    class N1(t1):
        pass

    # This should generate an error.
    class N2(t2):
        pass


# This should generate an error.
class O1(A | Any):
    pass


# This should generate an error.
class O2(Union[A, Any]):
    pass


# This should generate an error because a TypeVar can't be used as a base class.
class K(T):
    pass


class L(type[T]):
    pass


def func2(cls: type[T]):
    class M(cls):
        pass


def func3(cls: T2) -> T2:
    class M(cls):
        pass
    
    return M
