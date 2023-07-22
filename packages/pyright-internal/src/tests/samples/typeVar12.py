# This sample tests the case where a function-scoped TypeVar or
# ParamSpec is used only within a function's return type and only within
# a single Callable within that return type. In such cases, the TypeVar or
# ParamSpec is rescoped to the Callable rather than the function.

from typing import Callable, Generic, Optional, ParamSpec, TypeVar

S = TypeVar("S")
T = TypeVar("T")
P = ParamSpec("P")

CallableAlias1 = Callable[[T], T]
CallableAlias2 = Callable[[T], T] | T


def func1() -> Callable[[T], T] | None:
    # This should generate an error.
    x: Optional[T] = None


def func2() -> Callable[[T], T] | list[T] | None:
    x: Optional[T] = None


def func3() -> CallableAlias1[T] | None:
    # This should generate an error.
    x: Optional[T] = None


def func4() -> CallableAlias2[T] | None:
    x: Optional[T] = None


def func5() -> Callable[[list[T]], set[T]] | None:
    # This should generate an error.
    x: Optional[T] = None


def func6() -> Callable[[list[T]], set[T]] | Callable[[set[T]], set[T]] | None:
    x: Optional[T] = None


def func7() -> Callable[P, None] | None:
    # This should generate two errors, once for each P reference.
    def inner(*args: P.args, **kwargs: P.kwargs) -> None:
        pass

    return


def func8() -> Callable[[T], T]:
    ...


func9 = func8()
v1 = func9(func9)
reveal_type(v1, expected_text="(T(1)@func8) -> T(1)@func8")
v2 = func9(func9(func9))
reveal_type(v2, expected_text="(T(2)(1)@func8) -> T(2)(1)@func8")


class A(Generic[T]):
    def method1(self) -> Callable[[T], T] | None:
        x: Optional[T] = None


class B(Generic[S]):
    def method1(self) -> Callable[[T], T] | None:
        # This should generate an error.
        x: Optional[T] = None
