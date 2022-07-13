# This sample tests the handling of type narrowing of a TypedDict based
# on an assignment to a not-required key.

from typing import TypedDict
from typing_extensions import NotRequired, Required


class TD1(TypedDict):
    x: NotRequired[str]


class TD2(TypedDict):
    x: Required[str]


def func1(td: TD1 | TD2):
    # This should generate an error because "x" is not required in TD1.
    v1 = td["x"]


def func2(td: TD1 | TD2):
    td["x"] = "hi"
    v1 = td["x"]


def func3(td: TD1 | TD2, opt: bool):
    if opt:
        td["x"] = "hi"

    # This should generate an error because "x" is not required in TD1.
    v1 = td["x"]


def func4(td: TD1 | TD2, opt: bool):
    if opt:
        td["x"] = "hi"
    else:
        td["x"] = "hi"

    v1 = td["x"]
