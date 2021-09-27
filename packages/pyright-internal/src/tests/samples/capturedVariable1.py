# This sample tests the code flow analysis used to determine
# whether it is safe to narrow the type of a captured variable.

from typing import Optional


def get_optional_int() -> Optional[int]:
    ...


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
            v1 + 5

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
