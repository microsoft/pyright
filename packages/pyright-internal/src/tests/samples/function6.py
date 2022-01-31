# This sample tests the case where a generic function return type
# is handled correctly when its result is assigned to a LHS with
# an expected type that is a union (in this case, "msg" has a type
# of Union[str, None] and "get" returns the type Union[_VT_co, _T].

from typing import Optional


def f(key: str, msg: Optional[str]):
    if msg is None:
        my_dict = {"a": "b"}
        msg = my_dict.get(key, "c")

        # Without bidirectional type inference, the
        # revealed type will be "str", but since "msg"
        # has a declared type, it will be used in this
        # case to inform the type "str | None", which
        # is a valid solution for the constraint solver.
        # Unfortunately, it's probably not the answer
        # the user expects in this case.
        reveal_type(msg, expected_text="str | None")

        x = my_dict.get(key, "c")
        reveal_type(x, expected_text="str")
