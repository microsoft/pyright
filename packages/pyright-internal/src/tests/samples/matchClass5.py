# This sample tests the detection of too many positional patterns.

from dataclasses import dataclass


@dataclass
class A:
    a: int


class B:
    a: int
    b: int

    __match_args__ = ("a", "b")


class C(B): ...


class D(int): ...


def func1(subj: A | B):
    match subj:
        # This should generate an error because A accepts only
        # one positional pattern.
        case A(1, 2):
            pass

        case A(1):
            pass

        case A():
            pass

        case B(1, 2):
            pass

        # This should generate an error because B accepts only
        # two positional patterns.
        case B(1, 2, 3):
            pass

        # This should generate an error because B accepts only
        # two positional patterns.
        case C(1, 2, 3):
            pass

        case D(1):
            pass

        # This should generate an error because D accepts only
        # one positional pattern.
        case D(1, 2):
            pass

        case int(1):
            pass

        # This should generate an error because int accepts only
        # one positional pattern.
        case int(1, 2):
            pass
