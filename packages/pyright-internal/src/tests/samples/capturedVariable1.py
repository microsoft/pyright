# This sample tests the code flow analysis used to determine
# whether it is safe to narrow the type of a captured variable.

from typing import NoReturn, Optional


def get_optional_int() -> Optional[int]: ...


v0 = get_optional_int()
if v0 is not None:
    # This should generate an error because v0 is
    # a global variable and could be reassigned
    # outside of this module.
    lambda: v0 + 5


def func0():
    v1 = get_optional_int()
    if v1 is not None:
        lambda: v1 + 5

    v2 = get_optional_int()
    if v2 is not None:
        # This should generate an error because v2
        # is reassigned after capture.
        lambda: v2 + 5
    v2 = None

    v3 = get_optional_int()
    if v3 is not None:
        lambda: v3 + 5
    else:
        v3 = None

    # This should generate an error because v4 is
    # not bound prior to the capture.
    lambda: v4 + 5
    v4 = get_optional_int()


def func1(v1: Optional[int]):
    if v1 is not None:
        lambda: v1 + 5


def func2(v1: Optional[int]):
    if v1 is not None:

        def func2_inner1():
            x = v1 + 5

            def func2_inner2():
                lambda: v1 + 5

            func2_inner2()

        func2_inner1()


def func3():
    v1: Optional[int] = 3
    lambda: v1 + 5


def func4():
    v1: Optional[int] = 3
    # This should generate an error because v1
    # is reassigned after capture.
    lambda: v1 + 5
    v1 = None


def func5():
    v1: Optional[int] = 3

    while True:
        lambda: v1 + 5


def func6():
    v1: Optional[int] = 3

    while True:
        if v1 is not None:
            # This should generate an error because
            # v1 is reassigned on a code path that is
            # reachable from the lambda.
            lambda: v1 + 5
        else:
            v1 = None


def func7():
    while True:
        # This should generate an error because v1 is
        # potentially unbound prior to capture.
        lambda: v1 + 5

        v1: Optional[int] = 3


def func8() -> NoReturn: ...


def func9(x: str | None):
    if not x:
        func8()

    def foo() -> str:
        return x.upper()

    return x.upper()


def func10(cond: bool, val: str):
    x: str | None = val if cond else None
    y: str | None = val if cond else None

    def inner1():
        nonlocal x
        x = None

    if x is not None and y is not None:

        def inner2():
            reveal_type(x, expected_text="str | None")
            reveal_type(y, expected_text="str")


def func11(foo: list[int] | None):
    if isinstance(foo, list):

        def inner() -> list[int]:
            return [x for x in foo]


def func12() -> None:
    counter = 0

    def inner() -> None:
        nonlocal counter
        reveal_type(counter, expected_text="int")
        counter += 1

    inner()
