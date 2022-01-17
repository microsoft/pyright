# This sample tests type narrowing for assignments
# where the source contains Unknown or Any type
# arguments.

from typing import Any, Dict


def func1(struct: Dict[Any, Any]):
    a1: Dict[str, Any] = struct
    reveal_type(a1, expected_text="Dict[str, Any]")


def func2(struct: Any):
    a1: Dict[Any, str] = struct
    reveal_type(a1, expected_text="Dict[Any, str]")

    if isinstance(struct, Dict):
        a2: Dict[str, Any] = struct
        reveal_type(a2, expected_text="Dict[str, Any]")
