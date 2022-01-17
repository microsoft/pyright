# This sample tests that binary operations "or" and "and"
# properly handle bidirectional type inference.

from typing import Any, Dict, Optional


def func_or(a: Optional[Dict[str, Any]]):
    a = a or dict()
    reveal_type(a, expected_text="Dict[str, Any]")


def func_and():
    a: Optional[Dict[str, Any]] = True and dict()
    reveal_type(a, expected_text="dict[str, Any]")
