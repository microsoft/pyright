# This sample tests the reportMatchNotExhaustive diagnostic check.

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
    green= 1
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
