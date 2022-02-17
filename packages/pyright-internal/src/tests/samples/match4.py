# This sample tests type checking for match statements (as
# described in PEP 634) that contain value patterns.

from enum import Enum, auto
from typing import Tuple, TypeVar, Union
from http import HTTPStatus

def handle_reply(reply: Tuple[HTTPStatus, str] | Tuple[HTTPStatus]):
    match reply:
        case (HTTPStatus.OK as a1, a2):
            reveal_type(a1, expected_text="Literal[HTTPStatus.OK]")
            reveal_type(a2, expected_text="str")

        case (HTTPStatus.NOT_FOUND as d1, ):
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


def test_class_var(value_to_match: str):
    match value_to_match:
        case MyClass.class_var_1 as a1:
            reveal_type(a1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")


TInt = TypeVar("TInt", bound=MyEnum)

def test_union(value_to_match: Union[TInt, MyEnum]) -> Union[TInt, MyEnum]:
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


def test_enum_narrowing(m: Union[Medal, Color, int]):
    match m:
        case Medal.gold as a1:
            reveal_type(a1, expected_text='Literal[Medal.gold]')
            reveal_type(m, expected_text='Literal[Medal.gold]')

        case Medal.silver as b1:
            reveal_type(b1, expected_text='Literal[Medal.silver]')
            reveal_type(m, expected_text='Literal[Medal.silver]')

        case Color() as c1:
            reveal_type(c1, expected_text='Color')
            reveal_type(m, expected_text='Color')

        case d1:
            reveal_type(d1, expected_text='int | Literal[Medal.bronze]')
            reveal_type(m, expected_text='int | Literal[Medal.bronze]')


class Foo(Enum):
    bar = auto()

    def __str__(self) -> str:
        match self:
            case Foo.bar:
                return "bar"

            case x:
                reveal_type(x, expected_text="Never")


