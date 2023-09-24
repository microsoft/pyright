# This sample tests the reportMatchNotExhaustive diagnostic check.

from types import NoneType
from typing import Literal
from enum import Enum


def func1(subj: Literal["a", "b"], cond: bool):
    # This should generate an error if reportMatchNotExhaustive is enabled.
    match subj:
        case "a":
            pass

        case "b" if cond:
            pass


def func2(subj: object):
    # This should generate an error if reportMatchNotExhaustive is enabled.
    match subj:
        case int():
            pass


def func3(subj: object):
    match subj:
        case object():
            pass


def func4(subj: tuple[str] | tuple[int]):
    match subj[0]:
        case str():
            pass

        case int():
            pass


def func5(subj: Literal[1, 2, 3]):
    # This should generate an error if reportMatchNotExhaustive is enabled.
    match subj:
        case 1 | 2:
            pass


class Color(Enum):
    red = 0
    green = 1
    blue = 2


def func6(subj: Color):
    # This should generate an error if reportMatchNotExhaustive is enabled.
    match subj:
        case Color.red:
            pass

        case Color.green:
            pass


class ClassA:
    def method1(self) -> str:
        match self:
            case ClassA():
                return ""


def func7() -> int:
    match [10]:
        case [*values]:
            return values[0]


class SingleColor(Enum):
    red = 0


def func8(subj: SingleColor) -> int:
    match subj:
        case SingleColor.red:
            return 1


def func9(subj: int | None):
    match subj:
        case NoneType():
            return 1
        case int():
            return 2


def func10(subj: Color | None = None) -> list[str]:
    results = [""]
    for x in [""]:
        match subj:
            case None:
                results.append(x)
            case Color.red:
                pass
            case Color.green:
                pass
            case Color.blue:
                pass
    return results


def func11(subj: int | float | None):
    match subj:
        case float():
            reveal_type(subj, expected_text="float")
        case int():
            reveal_type(subj, expected_text="int")
        case NoneType():
            reveal_type(subj, expected_text="None")
