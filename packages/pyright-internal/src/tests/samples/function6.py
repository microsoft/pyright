# This sample tests the case where a generic function return type
# is handled correctly when its result is assigned to a LHS with
# an expected type that is a union (in this case, "msg" has a type
# of Union[str, None] and "get" returns the type Union[_VT_co, _T].

from typing import Optional


def f(key: str, msg: Optional[str]) -> str:
    if msg is None:
        msg = {"a": "b"}.get(key, "c")
    return msg
