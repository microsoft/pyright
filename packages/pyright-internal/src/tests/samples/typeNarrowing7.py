# This sample tests type narrowing for index operations.

from typing import Dict, List, Optional, Union


class Foo:
    val: List[List[Optional[str]]] = []


def func1(v1: List[Optional[complex]]):
    if v1[0] and v1[1]:
        reveal_type(v1[0], expected_text="complex")
        reveal_type(v1[1], expected_text="complex")
        reveal_type(v1[2], expected_text="complex | None")

        v1[0], v1[1] = None, None
        reveal_type(v1[0], expected_text="None")
        reveal_type(v1[1], expected_text="None")

        v1[0], v1[1] = 1, 2
        reveal_type(v1[0], expected_text="Literal[1]")
        reveal_type(v1[1], expected_text="Literal[2]")

        v1 = []
        reveal_type(v1[0], expected_text="complex | None")

    i = 1
    if v1[i]:
        reveal_type(v1[i], expected_text="complex | None")

    foo = Foo()
    if foo.val[0][2]:
        reveal_type(foo.val[0][2], expected_text="str")
        reveal_type(foo.val[1][2], expected_text="str | None")

        foo.val = []
        reveal_type(foo.val[0][2], expected_text="str | None")


def func2(v1: List[Union[Dict[str, str], List[str]]]):
    if isinstance(v1[0], dict):
        reveal_type(v1[0], expected_text="Dict[str, str]")
        reveal_type(v1[1], expected_text="Dict[str, str] | List[str]")


def func3():
    v1: Dict[str, int] = {}

    reveal_type(v1["x1"], expected_text="int")
    v1["x1"] = 3
    reveal_type(v1["x1"], expected_text="Literal[3]")

    v1[f"x2"] = 5
    reveal_type(v1["x2"], expected_text="int")

    v1 = {}
    reveal_type(v1["x1"], expected_text="int")

    v2: Dict[str, Dict[str, int]] = {}

    reveal_type(v2["y1"]["y2"], expected_text="int")
    v2["y1"]["y2"] = 3
    reveal_type(v2["y1"]["y2"], expected_text="Literal[3]")
    v2["y1"] = {}
    reveal_type(v2["y1"]["y2"], expected_text="int")
