# This sample tests inference behaviors related to TypeForm.

# pyright: strict


def func1():
    return "int | str"


reveal_type(func1(), expected_text="Literal['int | str']")


def func2():
    return int | str


reveal_type(func2(), expected_text="UnionType")


v1 = [int | str, str | bytes]
reveal_type(v1, expected_text="list[UnionType]")

v2 = {int | str, str | bytes}
reveal_type(v2, expected_text="set[UnionType]")

v3 = {int | str: str | bytes}
reveal_type(v3, expected_text="dict[UnionType, UnionType]")
