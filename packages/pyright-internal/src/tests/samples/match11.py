# This sample tests the reportUnnecessaryComparison check when applied
# to match statements.

from typing import Literal

Letters = Literal["A", "B", "C"]


def func1(subj: Letters):
    match subj:
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case "A" | "B" | "D":
            pass
        case str():
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case "C":
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case x:
            print(x)


def func2(subj: int | dict[str, str]):
    match subj:
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case str() if subj > 4:
            pass
        case int() if subj > 4:
            pass
        case int():
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case int():
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case (a, b):
            print(a, b)
        case {"": d}:
            print(d)
        case dict():
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case x:
            print(x)
