# This sample tests that binary operations "or" and "and"
# properly handle bidirectional type inference.

from typing import Any, Dict, Literal, Optional


def func_or(a: Optional[Dict[str, Any]]):
    a = a or dict()
    t1: Literal["Dict[str, Any]"] = reveal_type(a)


def func_and():
    a: Optional[Dict[str, Any]] = True and dict()
    t1: Literal["dict[str, Any]"] = reveal_type(a)
