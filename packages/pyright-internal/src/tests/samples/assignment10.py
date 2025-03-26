# This sample tests some cases where types are narrowed on assignment,
# including some cases that involve "Any".

from typing import Any, Generic, Iterable, TypeVar


class A:
    instance: "A | None"

    def __init__(self) -> None:
        self.foo: bool

    @classmethod
    def method1(cls) -> bool:
        if cls.instance is None:
            cls.instance = cls()
        return cls.instance.foo


T = TypeVar("T")


class B(Generic[T]): ...


def func1(v1: list[Any | None], v2: list[int | str]):
    x1: list[int | None] = v1
    reveal_type(x1, expected_text="list[int | None]")

    x2: list[Any] = v2
    reveal_type(x2, expected_text="list[Any]")

    x3: list[Any | str] = v2
    reveal_type(x3, expected_text="list[Any | str]")


def func2(v1: dict[int, Any | None], v2: dict[int, int | str]):
    x1: dict[int, int | None] = v1
    reveal_type(x1, expected_text="dict[int, int | None]")

    x2: dict[Any, Any] = v2
    reveal_type(x2, expected_text="dict[Any, Any]")

    x3: dict[Any, Any | str] = v2
    reveal_type(x3, expected_text="dict[Any, Any | str]")


def func3(y: list[int]):
    x1: Iterable[int | B[Any]] = y
    reveal_type(x1, expected_text="list[int]")

    x2: Iterable[Any | B[Any]] = y
    reveal_type(x2, expected_text="list[int]")

    x3: Iterable[Any] = y
    reveal_type(x3, expected_text="list[int]")


def func4(y: list[Any]):
    x1: Iterable[int | B[Any]] = y
    reveal_type(x1, expected_text="list[Any]")

    x2: Iterable[Any | B[Any]] = y
    reveal_type(x2, expected_text="list[Any]")

    x3: Iterable[Any] = y
    reveal_type(x3, expected_text="list[Any]")


def func5(v1: list[Any | None]):
    x1: list[int | None] = v1
    reveal_type(x1, expected_text="list[int | None]")


def func6(v1: tuple[Any], v2: tuple[int, Any], v3: tuple[Any, ...]):
    x1: tuple[int] = v1
    reveal_type(x1, expected_text="tuple[int]")

    x2: tuple[int, str] = v2
    reveal_type(x2, expected_text="tuple[int, str]")

    x3: tuple[str, ...] = v3
    reveal_type(x3, expected_text="tuple[str, ...]")
