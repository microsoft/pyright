# This sample tests the type checker's handling of the
# builtin "Callable" class.

from typing import Callable

Callable1 = Callable[["A"], None]


class A:
    pass


Callable2 = Callable[[A], None]


def func1(a: Callable1):
    a(A())


def func2(a: Callable2):
    a(A())


Callable3 = Callable[..., int]


def func3(a: Callable3) -> int:
    return a(1, 2, 3) + a() + a("hello") + a([])


# This should generate an error (... not allowed in param list).
Callable4 = Callable[[...], int]

# This should generate an error (too many arguments).
Callable5 = Callable[..., int, int]


# Test Callable with no parameters
Callable6 = Callable[[], str]


def func6(a: Callable6):
    a()
    # This should generate an error.
    a(1)


def func7(a: Callable):
    reveal_type(a, expected_text="(...) -> Unknown")
    b = a(3, 4, 5)
    reveal_type(b, expected_text="Unknown")
