# This sample tests TypeGuard and TypeIs narrowing for bound, unbound,
# static, reordered keyword, and module-qualified function calls.

from typing import Any, TypeGuard, TypeIs
import typeGuard1


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


def test_bound_method_keyword(c: Checker, x: object):
    if c.is_str(val=x):
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


def test_unbound_method_keyword(c: Checker, x: object):
    if Checker.is_str(val=x, self=c):
        reveal_type(x, expected_text="str")
        reveal_type(c, expected_text="Checker")
    else:
        reveal_type(x, expected_text="object")
        reveal_type(c, expected_text="Checker")


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


def test_module_qualified_free_function(a: tuple[int, ...]):
    if typeGuard1.is_two_element_tuple(a):
        reveal_type(a, expected_text="tuple[int, int]")
    else:
        reveal_type(a, expected_text="tuple[int, ...]")
