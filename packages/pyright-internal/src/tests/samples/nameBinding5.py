# This sample tests that unassigned variables within a class body
# are resolved to the global scope.

a = 0
b = 0
c = 0
d = 0


def func_a() -> None:
    a = "a"

    class A:
        reveal_type(a, expected_text="Literal['a']")


def func_b() -> None:
    b = "a"

    class A:
        reveal_type(b, expected_text="int")
        b = "b"
        reveal_type(b, expected_text="str")

    reveal_type(b, expected_text="Literal['a']")


def func_c() -> None:
    c = "a"

    class A:
        nonlocal c
        reveal_type(c, expected_text="Literal['a']")
        c = 0

    reveal_type(c, expected_text="int")


def func_d() -> None:
    d = "a"

    class A:
        global d
        reveal_type(d, expected_text="int")
        d = "b"

    reveal_type(d, expected_text="Literal['a']")


reveal_type(a, expected_text="Literal[0]")
reveal_type(b, expected_text="Literal[0]")
reveal_type(c, expected_text="Literal[0]")
reveal_type(d, expected_text="Literal[0]")
