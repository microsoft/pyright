# This sample is used in conjunction with protocolModule2.py.

from typing import Union


var_1: int = 3
var_2: Union[int, str] = "hello"


def func_1(a: int, b: str) -> str:
    return "hi"


def func_2() -> str:
    return "hi"
