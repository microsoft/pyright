# This sample tests that type guards work correctly
# with the walrus operator.

import re


def foo(s: str) -> str:
    if m := re.fullmatch("(test).+", s):
        return m.group(1)
    return "oops"
