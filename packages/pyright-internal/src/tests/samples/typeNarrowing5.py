# This sample tests type narrowing for assignments
# where the source contains Unknown or Any type
# arguments.

from typing import Any, Dict, Literal


def func1(struct: Dict[Any, Any]):
    a1: Dict[str, Any] = struct
    t1: Literal["Dict[str, Any]"] = reveal_type(a1)


def func2(struct: Any):
    a1: Dict[Any, str] = struct
    t1: Literal["Dict[Any, str]"] = reveal_type(a1)

    if isinstance(struct, Dict):
        a2: Dict[str, Any] = struct
        t2: Literal["Dict[str, Any]"] = reveal_type(a2)
