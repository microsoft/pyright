# This sample tests type narrowing for the "in" operator.

from typing import (
    Any,
    Callable,
    Generic,
    Literal,
    LiteralString,
    ParamSpec,
    TypeVar,
    TypedDict,
)
import random


def func0(x: str | None, y: int | str):
    if random.random() < 0.5:
        x = None
        y = 1
    else:
        x = "2"
        y = "2"

    if x in ["2"]:
        reveal_type(x, expected_text="Literal['2']")

    if y in [1]:
        reveal_type(y, expected_text="Literal[1]")


def func1(x: int | str | None, y: Literal[1, 2, "b"], b: int):
    if x in (1, 2, "a"):
        reveal_type(x, expected_text="Literal[1, 2, 'a']")

    if x in (1, "2"):
        reveal_type(x, expected_text="Literal[1, '2']")

    if x in (1, None):
        reveal_type(x, expected_text="Literal[1] | None")

    if x in (1, b, "a"):
        reveal_type(x, expected_text="int | Literal['a']")

    if y in (1, b, "a"):
        reveal_type(y, expected_text="Literal[1, 2]")

    if y in (1, "a"):
        reveal_type(y, expected_text="Literal[1]")

    if y in (1, "b"):
        reveal_type(y, expected_text="Literal[1, 'b']")


def func2(a: Literal[1, 2, 3]):
    x = (1, 2)
    if a in x:
        reveal_type(a, expected_text="Literal[1, 2]")
    else:
        reveal_type(a, expected_text="Literal[3]")


def func3(val: str | None, container: frozenset[str]):
    if val in container:
        reveal_type(val, expected_text="str")
    else:
        reveal_type(val, expected_text="str | None")


def func4(val: str | None, container: list[str]):
    if val not in container:
        reveal_type(val, expected_text="str | None")
    else:
        reveal_type(val, expected_text="str")


def func5(x: str | None, y: int | None, z: dict[str, str]):
    if x in z:
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="str | None")

    if y not in z:
        reveal_type(y, expected_text="int | None")
    else:
        reveal_type(y, expected_text="Never")


def func6(x: type):
    if x in (str, int, float, bool):
        reveal_type(x, expected_text="type[str] | type[int] | type[float] | type[bool]")
    else:
        reveal_type(x, expected_text="type")


def func7(x: object | bytes, y: str, z: int):
    if x in (y, z):
        reveal_type(x, expected_text="object")
    else:
        reveal_type(x, expected_text="object | bytes")
    reveal_type(x, expected_text="object | bytes")


def func8(x: object):
    if x in ("a", "b", 2, None):
        reveal_type(x, expected_text="Literal['a', 'b', 2] | None")


def func9(x: Literal["A", "B", "C", None, True]):
    if x in (None, "B", True):
        reveal_type(x, expected_text="Literal['B', True] | None")
    else:
        reveal_type(x, expected_text="Literal['A', 'C']")
        if x not in ("A", "C"):
            reveal_type(x, expected_text="Never")
        else:
            reveal_type(x, expected_text="Literal['A', 'C']")

    if x in ("A", "B"):
        reveal_type(x, expected_text="Literal['B', 'A']")
    else:
        reveal_type(x, expected_text="Literal[True, 'C'] | None")


def func10(x: Literal["A", "B"], y: tuple[Literal["A"], ...]):
    if x in y:
        reveal_type(x, expected_text="Literal['A']")
    else:
        reveal_type(x, expected_text="Literal['A', 'B']")


class TD1(TypedDict):
    x: str


class TD2(TypedDict):
    y: str


T1 = TypeVar("T1", TD1, TD2)


def func12(v: T1):
    if "x" in v:
        reveal_type(v, expected_text="TD1* | TD2*")
    else:
        reveal_type(v, expected_text="TD2*")


P = ParamSpec("P")


class Container(Generic[P]):
    def __init__(self, func: Callable[P, str]) -> None:
        self.func = func

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> str:
        if "data" in kwargs:
            raise ValueError("data is not allowed in kwargs")

        return self.func(*args, **kwargs)


T13 = TypeVar("T13")


def func13(x: type[T13]) -> type[T13]:
    if x in (str, int, float):
        reveal_type(x, expected_text="type[str]* | type[int]* | type[float]*")

    return x


def func14(x: str, y: dict[Any, Any]):
    if x in y:
        reveal_type(x, expected_text="str")


def func15(x: Any, y: dict[str, str]):
    if x in y:
        reveal_type(x, expected_text="Any")


def func16(x: int, y: list[Literal[0, 1]]):
    if x in y:
        reveal_type(x, expected_text="Literal[0, 1]")


def func17(x: Literal[-1, 0], y: list[Literal[0, 1]]):
    if x in y:
        reveal_type(x, expected_text="Literal[0]")


def func18(x: Literal[0, 1, 2], y: list[Literal[0, 1]]):
    if x in y:
        reveal_type(x, expected_text="Literal[0, 1]")


def func19(x: float, y: list[int]):
    if x in y:
        reveal_type(x, expected_text="float")


def func20(x: float, y: list[Literal[0, 1]]):
    if x in y:
        reveal_type(x, expected_text="Literal[0, 1]")


def func21(x: int, y: list[Literal[0, True]]):
    if x in y:
        reveal_type(x, expected_text="Literal[0, True]")


def func22(x: bool, y: list[Literal[0, 1]]):
    if x in y:
        reveal_type(x, expected_text="bool")


def func23[T: LiteralString](x: str, y: tuple[T, ...]) -> T:
    if x in y:
        return x
    raise ValueError(f"Invalid value {x!r}")
