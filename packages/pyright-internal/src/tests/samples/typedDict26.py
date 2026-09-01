# This sample tests version-conditional items in a TypedDict definition.

import sys
from typing import TypedDict


class ConditionalTypedDict(TypedDict):
    always: int
    if sys.version_info >= (3, 12):
        present: str
    if sys.version_info >= (4, 0):
        future: bytes


ConditionalTypedDict(always=1, present="")

# This should generate an error because the test targets Python 3.13.
ConditionalTypedDict(always=1, present="", future=b"")
