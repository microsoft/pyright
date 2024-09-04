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
