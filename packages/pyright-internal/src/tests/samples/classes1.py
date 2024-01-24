# This sample tests the type checker's ability to
# handle various class definition cases.


from typing import Any, TypeVar


T = TypeVar("T")


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


class G(E, metaclass=type):
    def my_method(self):
        print(__class__)


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


# This should generate an error because a TypeVar can't be used as a base class.
class K(T):
    pass


class L(type[T]):
    pass


def func2(cls: type[T]):
    class M(cls):
        pass
