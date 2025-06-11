# This sample tests the case where a type variable is used to define
# the extra_items in a TypedDict.

from typing_extensions import TypedDict  # pyright: ignore[reportMissingModuleSource]


class TD1[T](TypedDict, extra_items=T):
    a: T


d1: TD1 = {"a": 1}
d2: TD1[int] = {"a": 1}

reveal_type(d1["other"], expected_text="Unknown")
reveal_type(d2["other"], expected_text="int")
