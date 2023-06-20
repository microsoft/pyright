# This sample tests type narrowing for index operations.


class Foo:
    val: list[list[str | None]] = []


def func1(v1: list[complex | None]):
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

    if v1[-1]:
        reveal_type(v1[-1], expected_text="complex")


def func2(v1: list[dict[str, str] | list[str]]):
    if isinstance(v1[0], dict):
        reveal_type(v1[0], expected_text="dict[str, str]")
        reveal_type(v1[1], expected_text="dict[str, str] | list[str]")

    if isinstance(v1[-1], list):
        reveal_type(v1[-1], expected_text="list[str]")


def func3():
    v1: dict[str, int] = {}

    reveal_type(v1["x1"], expected_text="int")
    v1["x1"] = 3
    reveal_type(v1["x1"], expected_text="Literal[3]")

    v1[f"x2"] = 5
    reveal_type(v1["x2"], expected_text="int")

    v1 = {}
    reveal_type(v1["x1"], expected_text="int")

    v2: dict[str, dict[str, int]] = {}

    reveal_type(v2["y1"]["y2"], expected_text="int")
    v2["y1"]["y2"] = 3
    reveal_type(v2["y1"]["y2"], expected_text="Literal[3]")
    v2["y1"] = {}
    reveal_type(v2["y1"]["y2"], expected_text="int")
