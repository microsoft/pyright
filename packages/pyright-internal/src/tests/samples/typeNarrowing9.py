# This sample tests that "is not None" / "is None" narrowing applied to an
# assignment expression also narrows the RHS expression, consistent with
# truthiness narrowing of assignment expressions (see typeNarrowing4.py).


class C:
    def method1(self) -> None:
        pass


def func1(b: C | None) -> None:
    # Truthiness already narrows both the walrus target and the RHS.
    if c := b:
        reveal_type(c, expected_text="C")
        reveal_type(b, expected_text="C")
        b.method1()

    # "is not None" should narrow the RHS the same way.
    if (d := b) is not None:
        reveal_type(d, expected_text="C")
        reveal_type(b, expected_text="C")
        b.method1()


def func2(x: str | None) -> str:
    if (y := x) is not None:
        reveal_type(y, expected_text="str")
        reveal_type(x, expected_text="str")
        return x
    return ""


def func3(x: str | None) -> None:
    if (y := x) is None:
        reveal_type(y, expected_text="None")
        reveal_type(x, expected_text="None")
    else:
        reveal_type(y, expected_text="str")
        reveal_type(x, expected_text="str")


def func4(x: int | None) -> None:
    assert (y := x) is not None
    reveal_type(y, expected_text="int")
    reveal_type(x, expected_text="int")


def func5(x: str | None) -> None:
    # == None / != None should behave like is/is not None.
    if (y := x) != None:
        reveal_type(y, expected_text="str")
        reveal_type(x, expected_text="str")
