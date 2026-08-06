# This sample tests TypeGuard and TypeIs narrowing for bound, unbound,
# and static method calls.

from typing import Any, TypeGuard, TypeIs


class Checker:
    def is_str(self, val: object) -> TypeGuard[str]:
        return isinstance(val, str)

    def is_int(self, val: object) -> TypeIs[int]:
        return isinstance(val, int)

    @staticmethod
    def is_float(val: object) -> TypeGuard[float]:
        return isinstance(val, float)


def test_bound_method(c: Checker, x: object):
    if c.is_str(x):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_bound_method_typeis(c: Checker, x: int | str):
    if c.is_int(x):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="str")


def test_unbound_method(c: Checker, x: object):
    if Checker.is_str(c, x):
        reveal_type(x, expected_text="str")
    else:
        reveal_type(x, expected_text="object")


def test_unbound_method_typeis(c: Checker, x: int | str):
    if Checker.is_int(c, x):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="str")


def test_static_method(x: object):
    if Checker.is_float(x):
        reveal_type(x, expected_text="float")
    else:
        reveal_type(x, expected_text="object")
