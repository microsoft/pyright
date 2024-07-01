# This sample tests type checking for match statements (as
# described in PEP 634) that contain value patterns.

from dataclasses import dataclass
from enum import Enum, auto
from typing import Annotated, TypeVar
from http import HTTPStatus

# pyright: reportIncompatibleMethodOverride=false


def handle_reply(reply: tuple[HTTPStatus, str] | tuple[HTTPStatus]):
    match reply:
        case (HTTPStatus.OK as a1, a2):
            reveal_type(a1, expected_text="Literal[HTTPStatus.OK]")
            reveal_type(a2, expected_text="str")

        case (HTTPStatus.NOT_FOUND as d1,):
            reveal_type(d1, expected_text="Literal[HTTPStatus.NOT_FOUND]")


class MyEnum(Enum):
    V1 = 0
    V2 = 1


class MyClass:
    class_var_1: "MyClass"

    def __eq__(self, object: "MyClass") -> bool: ...


def test_unknown(value_to_match):
    match value_to_match:
        case MyEnum.V1 as a1:
            reveal_type(a1, expected_text="Unknown")
            reveal_type(value_to_match, expected_text="Unknown")


def test_enum(value_to_match: MyEnum):
    match value_to_match:
        case MyEnum.V1 as a1:
            reveal_type(a1, expected_text="Literal[MyEnum.V1]")
            reveal_type(value_to_match, expected_text="Literal[MyEnum.V1]")
        case y:
            reveal_type(y, expected_text="Literal[MyEnum.V2]")
            reveal_type(value_to_match, expected_text="Literal[MyEnum.V2]")


def test_class_var(value_to_match: str):
    match value_to_match:
        case MyClass.class_var_1 as a1:
            reveal_type(a1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")


TInt = TypeVar("TInt", bound=MyEnum)


def test_union(value_to_match: TInt | MyEnum) -> TInt | MyEnum:
    match value_to_match:
        case MyEnum.V1 as a1:
            reveal_type(a1, expected_text="Literal[MyEnum.V1]")
            reveal_type(value_to_match, expected_text="Literal[MyEnum.V1]")

    return value_to_match


class Medal(Enum):
    gold = 1
    silver = 2
    bronze = 3


class Color(Enum):
    red = 1
    blue = 2
    green = 3


def test_enum_narrowing(m: Medal | Color | int):
    match m:
        case Medal.gold as a1:
            reveal_type(a1, expected_text="Literal[Medal.gold]")
            reveal_type(m, expected_text="Literal[Medal.gold]")

        case Medal.silver as b1:
            reveal_type(b1, expected_text="Literal[Medal.silver]")
            reveal_type(m, expected_text="Literal[Medal.silver]")

        case Color() as c1:
            reveal_type(c1, expected_text="Color")
            reveal_type(m, expected_text="Color")

        case d1:
            reveal_type(d1, expected_text="int | Literal[Medal.bronze]")
            reveal_type(m, expected_text="int | Literal[Medal.bronze]")


@dataclass
class DC1:
    a: Annotated[Color, str]


def test_enum_narrowing_with_annotated(subj: DC1) -> None:
    match subj.a:
        case Color.red:
            pass
        case Color.blue:
            pass
        case x:
            reveal_type(x, expected_text="Literal[Color.green]")


class Foo(Enum):
    bar = auto()

    def __str__(self) -> str:
        match self:
            case Foo.bar:
                return "bar"

            case x:
                reveal_type(x, expected_text="Never")


class Numbers:
    ZERO = 0.0
    ONE = 1
    INFINITY = float("inf")


def test_enum_narrowing_with_inf(subj: float):
    match subj:
        case Numbers.ONE:
            reveal_type(subj, expected_text="Literal[1]")
        case Numbers.INFINITY:
            reveal_type(subj, expected_text="float")
        case Numbers.ZERO:
            reveal_type(subj, expected_text="float")
        case f:
            reveal_type(subj, expected_text="float")
