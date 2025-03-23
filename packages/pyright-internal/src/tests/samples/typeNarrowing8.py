# This sample tests type narrowing for expressions that include
# assignment expressions (walrus operators).


def func1(v1: int | str, v2: str | None) -> None:
    if isinstance(x1 := v1, str):
        reveal_type(x1, expected_text="str")

    if (x2 := v2) == "hello":
        reveal_type(x2, expected_text="Literal['hello']")

    if x2 := v2:
        reveal_type(x2, expected_text="str")


class A:
    val: bool | None

    def __init__(self, val: bool | None) -> None:
        self.val = val


def func2():
    if (v1 := A(True)).val:
        reveal_type(v1.val, expected_text="Literal[True]")
