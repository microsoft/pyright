# This sample tests branch handling for conditional items in a TypedDict definition.

import sys as _sys
from typing import TypedDict


class BranchingTypedDict(TypedDict):
    if _sys.version_info < (3, 13):
        before: int
    elif _sys.version_info < (3, 14):
        current: str
    else:
        after: bytes


BranchingTypedDict(current="")

# These should generate errors because the test targets Python 3.13.
BranchingTypedDict(before=1)
BranchingTypedDict(after=b"")


class LiteralConditionalTypedDict(TypedDict):
    if True:
        literal: int
    else:
        unreachable: str


LiteralConditionalTypedDict(literal=1)

# This should generate an error because the item is in an unreachable branch.
LiteralConditionalTypedDict(unreachable="")


class ConditionalValueTypedDict(TypedDict):
    if _sys.version_info >= (3, 13):
        value: str
    else:
        value: int


ConditionalValueTypedDict(value="")

# This should generate an error because the active value type is str.
ConditionalValueTypedDict(value=1)


class DynamicConditionalTypedDict(TypedDict):
    if False:
        unreachable: str
    # This should generate an error because the condition cannot be evaluated statically.
    elif bool():
        conditional: int


class InvalidStatementTypedDict(TypedDict):
    if True:
        # This should generate an error because assignments are not allowed.
        invalid: int = 1

    if False:
        # This statement is unreachable and should not generate an error.
        ignored: int = 1


class InvalidControlFlowTypedDict(TypedDict):
    # This should generate an error because only statically evaluable if statements are allowed.
    while False:
        never: int
