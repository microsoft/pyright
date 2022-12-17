# This sample tests overload matching in cases where one or more
# matches are found due to an Any or Unknown argument.

from typing import Any, overload


@overload
def func1(x: int, y: float) -> float:
    ...

@overload
def func1(x: str, y: float) -> str:
    ...

def func1(x: str | int, y: float) -> float | str:
    ...


def func2(a: Any):
    v1 = func1(1, 3.4)
    reveal_type(v1, expected_text="float")

    v2 = func1("", 3.4)
    reveal_type(v2, expected_text="str")

    v3 = func1(a, 3.4)
    reveal_type(v3, expected_text="Unknown")

    v4 = func1("", a)
    reveal_type(v4, expected_text="str")

