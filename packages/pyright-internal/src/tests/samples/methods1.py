# This sample tests that instance methods, regardless of how they're
# defined or decorated, act like instance methods.

from typing import Any, Callable, ClassVar, Concatenate, Generic, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


def func1(self) -> None:
    print("func1", f"{self=}")


def deco1(x: Callable[P, R]) -> Callable[P, R]:
    return x


def deco2(
    func: Callable[P, Any],
) -> Callable[[Callable[..., Any]], Callable[Concatenate["ClassA", P], None]]:
    return lambda f: f  # type: ignore


class Deco3(Generic[P, R]):
    def __init__(self, func: Callable[P, R]):
        self.func = func

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        print("Deco3.__call__:", f"{self=}")
        return self.func(*args, **kwargs)


class Deco4:
    def __init__(self, func: Callable[..., Any]):
        self.func = func

    def __call__(self) -> None:
        print("Deco4.__call__:", f"{self=}")


class CallableA:
    def __call__(self) -> None:
        print("CallableA.__call__:", f"{self=}")


class DummyClass:
    def __init__(self, a: str, b: float) -> None:
        pass


def dummyFunc(a: str, b: float) -> None:
    pass


class ClassA:
    a: ClassVar[Callable[[Any], None]] = lambda self: None

    b1 = lambda self: None
    b2: ClassVar = lambda self: None

    c1 = func1
    c2: ClassVar = func1

    d1: CallableA = CallableA()
    d2: ClassVar[CallableA] = CallableA()

    e1 = deco1(func1)
    e2: ClassVar = deco1(func1)

    @deco1
    def f1(self) -> None:
        print("f1:", f"{self=}")

    @Deco3
    def g1(self) -> None:
        print("g1:", f"{self=}")

    @Deco4
    def h1(self) -> None:
        print("h1:", f"{self=}")

    @deco2(DummyClass)
    def i1(self, a: str, b: float) -> None:
        print("i1:", f"{self=}")

    @deco2(dummyFunc)
    def j1(self, a: str, b: float) -> None:
        print("j1:", f"{self=}")


a = ClassA()

a.a()

a.b1()
a.b2()

a.c1()
a.c2()

a.d1()
a.d2()

a.e1()
a.e2()

a.f1()

a.g1(a)

a.h1()

a.i1("", 0)

a.j1("", 0)
