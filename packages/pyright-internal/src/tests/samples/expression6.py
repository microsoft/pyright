# This sample tests that binary operations "or" and "and"
# properly handle bidirectional type inference.

from typing import Any


def func_or(a: dict[str, Any] | None):
    a = a or {"": 0}
    reveal_type(a, expected_text="dict[str, Any]")


def func_and():
    a: dict[str, Any] | None = True and {"": 0}
    reveal_type(a, expected_text="dict[str, Any]")
