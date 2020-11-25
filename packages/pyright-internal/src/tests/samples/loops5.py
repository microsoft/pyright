# This sample tests a case where a potential type alias
# ("a") is involved in a recursive type dependency
# ("a" depends on "test" which depends on "a").

# pyright: strict

from typing import Literal


test = {"key": "value"}

while True:
    a = test
    t1: Literal["dict[str, str]"] = reveal_type(a)
    test = a.copy()
    t2: Literal["dict[str, str]"] = reveal_type(test)
