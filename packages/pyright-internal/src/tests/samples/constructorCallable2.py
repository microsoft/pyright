# This sample tests the case where a constructor is converted to
# a callable.


from typing import (
    Any,
    Callable,
    Generic,
    NoReturn,
    ParamSpec,
    Self,
    TypeVar,
    overload,
    reveal_type,
)

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")


def accepts_callable(cb: Callable[P, R]) -> Callable[P, R]:
    return cb


class Class1:
    def __init__(self, x: int) -> None:
        pass


r1 = accepts_callable(Class1)
reveal_type(r1, expected_text="(x: int) -> Class1")
reveal_type(r1(1), expected_text="Class1")


class Class2:
    pass


r2 = accepts_callable(Class2)
reveal_type(r2, expected_text="() -> Class2")
reveal_type(r2(), expected_text="Class2")


class Class3:
    def __new__(cls, *args, **kwargs) -> Self: ...

    def __init__(self, x: int) -> None: ...


r3 = accepts_callable(Class3)
reveal_type(r3, expected_text="(x: int) -> Class3")
reveal_type(r3(3), expected_text="Class3")


class Class4:
    def __new__(cls, x: int) -> int: ...


r4 = accepts_callable(Class4)
reveal_type(r4, expected_text="(x: int) -> int")
reveal_type(r4(1), expected_text="int")


class Meta1(type):
    def __call__(cls, *args: Any, **kwargs: Any) -> NoReturn:
        raise NotImplementedError("Class not constructable")


class Class5(metaclass=Meta1):
    def __new__(cls, *args: Any, **kwargs: Any) -> Self:
        return super().__new__(cls)


r5 = accepts_callable(Class5)
reveal_type(r5, expected_text="(...) -> NoReturn")


class Class6Proxy: ...


class Class6:
    def __new__(cls) -> Class6Proxy:
        # This should generate an error because "cls" isn't compatible.
        return Class6Proxy.__new__(cls)

    def __init__(self, x: int) -> None:
        pass


r6 = accepts_callable(Class6)
reveal_type(r6, expected_text="() -> Class6Proxy")
reveal_type(r6(), expected_text="Class6Proxy")


class Class6_2:
    def __new__(cls) -> Any:
        return super().__new__(cls)

    def __init__(self, x: int) -> None:
        pass


r6_2 = accepts_callable(Class6_2)
reveal_type(r6_2, expected_text="() -> Any")
reveal_type(r6_2(), expected_text="Any")


class Class7(Generic[T]):
    @overload
    def __init__(self: "Class7[int]", x: int) -> None: ...

    @overload
    def __init__(self: "Class7[str]", x: str) -> None: ...

    def __init__(self, x: int | str) -> None:
        pass


r7 = accepts_callable(Class7)
reveal_type(
    r7, expected_text="Overload[(x: int) -> Class7[int], (x: str) -> Class7[str]]"
)

reveal_type(r7(0), expected_text="Class7[int]")
reveal_type(r7(""), expected_text="Class7[str]")


class Class7Sub[A, B](Class7[B]): ...


r7_sub = accepts_callable(Class7Sub)
reveal_type(
    r7_sub,
    expected_text="Overload[(x: int) -> Class7Sub[Unknown, int], (x: str) -> Class7Sub[Unknown, str]]",
)


class Class8(Generic[T]):
    def __new__(cls, x: T, y: list[T]) -> Self:
        return super().__new__(cls)


r8 = accepts_callable(Class8)
reveal_type(r8, expected_text="(x: T@Class8, y: list[T@Class8]) -> Class8[T@Class8]")
reveal_type(r8("", [""]), expected_text="Class8[str]")


class Class9:
    def __init__(self, x: list[T], y: list[T]) -> None:
        pass


r9 = accepts_callable(Class9)
reveal_type(r9, expected_text="(x: list[T@__init__], y: list[T@__init__]) -> Class9")
reveal_type(r9([""], [""]), expected_text="Class9")


M = TypeVar("M")


class Meta2(type):
    def __call__(cls: type[M], *args: Any, **kwargs: Any) -> M: ...


class Class10(metaclass=Meta2):
    def __new__(cls, x: int, y: str) -> Self:
        return super().__new__(cls)


r10 = accepts_callable(Class10)
reveal_type(r10, expected_text="(x: int, y: str) -> Class10")
reveal_type(r10(1, ""), expected_text="Class10")


class Class11[T, U]:
    def __init__[V](self: "Class11[V, int]", x: V) -> None: ...


class Class11Sub[A, B](Class11[A, B]): ...


class Class11Nested[A](Class11[list[A], int]): ...


r11_sub = accepts_callable(Class11Sub)
reveal_type(r11_sub, expected_text="(x: V@__init__) -> Class11Sub[V@__init__, int]")

r11_nested = accepts_callable(Class11Nested)
reveal_type(r11_nested, expected_text="(x: list[A@Class11Nested]) -> Class11Nested[A@Class11Nested]")
reveal_type(r11_nested([1]), expected_text="Class11Nested[int]")


class Class12[T, U]:
    first: T
    second: U

    def __init__(self: "Class12[int, str]", x: int) -> None: ...


class Class12Repeat[A](Class12[A, A]): ...


r12 = accepts_callable(Class12Repeat)
reveal_type(r12, expected_text="(x: int) -> Class12[int, str]")


class Class13[T, U]:
    first: T
    second: U

    @overload
    def __init__(self: "Class13[int, str]", x: int) -> None: ...
    @overload
    def __init__(self: "Class13[str, int]", x: str) -> None: ...
    def __init__(self, x: int | str) -> None: ...


class Class13Repeat[A](Class13[A, A]): ...


r13 = accepts_callable(Class13Repeat)
reveal_type(
    r13, expected_text="Overload[(x: int) -> Class13[int, str], (x: str) -> Class13[str, int]]"
)


class Class14[T]:
    def __init__[V](self: "Class14[V]", value: V) -> None: ...


class Class14Sub[A](Class14[A]):
    @classmethod
    def method1(cls) -> None:
        r14 = accepts_callable(cls)
        reveal_type(r14, expected_text="(value: A@Class14Sub) -> Self@Class14Sub[A@Class14Sub]")
