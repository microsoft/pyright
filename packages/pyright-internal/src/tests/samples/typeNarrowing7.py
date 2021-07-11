# This sample tests type narrowing for index operations.

from typing import Dict, List, Literal, Optional, Union


class Foo:
    val: List[List[Optional[str]]] = []


def func1(v1: List[Optional[complex]]):
    if v1[0] and v1[1]:
        t_v1_0: Literal["complex"] = reveal_type(v1[0])
        t_v1_1: Literal["complex"] = reveal_type(v1[1])
        t_v1_2: Literal["complex | None"] = reveal_type(v1[2])

        v1[0], v1[1] = None, None
        t_v1_0_updated1: Literal["None"] = reveal_type(v1[0])
        t_v1_1_updated1: Literal["None"] = reveal_type(v1[1])

        v1[0], v1[1] = 1, 2
        t_v1_0_updated2: Literal["Literal[1]"] = reveal_type(v1[0])
        t_v1_1_updated2: Literal["Literal[2]"] = reveal_type(v1[1])

        v1 = []
        t_v1_0_updated3: Literal["complex | None"] = reveal_type(v1[0])

    i = 1
    if v1[i]:
        t_v1_i: Literal["complex | None"] = reveal_type(v1[i])

    foo = Foo()
    if foo.val[0][2]:
        t_foo_val_0_2: Literal["str"] = reveal_type(foo.val[0][2])
        t_foo_val_1_2: Literal["str | None"] = reveal_type(foo.val[1][2])

        foo.val = []
        t_foo_val_0_2_updated: Literal["str | None"] = reveal_type(foo.val[0][2])


def func2(v1: List[Union[Dict[str, str], List[str]]]):
    if isinstance(v1[0], dict):
        t_v1_0: Literal["Dict[str, str]"] = reveal_type(v1[0])
        t_v1_1: Literal["Dict[str, str] | List[str]"] = reveal_type(v1[1])


def func3():
    v1: Dict[str, int] = {}

    t_v1_0: Literal["int"] = reveal_type(v1["x1"])
    v1["x1"] = 3
    t_v1_1: Literal["Literal[3]"] = reveal_type(v1["x1"])

    v1[f"x2"] = 5
    t_v1_2: Literal["int"] = reveal_type(v1["x2"])

    v1 = {}
    t_v1_3: Literal["int"] = reveal_type(v1["x1"])

    v2: Dict[str, Dict[str, int]] = {}

    t_v2_0: Literal["int"] = reveal_type(v2["y1"]["y2"])
    v2["y1"]["y2"] = 3
    t_v2_1: Literal["Literal[3]"] = reveal_type(v2["y1"]["y2"])
    v2["y1"] = {}
    t_v2_2: Literal["int"] = reveal_type(v2["y1"]["y2"])
