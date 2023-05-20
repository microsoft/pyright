# This sample tests error conditions for TypedDict classes with
# read-only entries as introduced in PEP 705.

from typing import NotRequired, Required, TypedDict
from typing_extensions import ReadOnly


class TD1(TypedDict):
    a: ReadOnly[int]
    b: Required[ReadOnly[str]]
    c: ReadOnly[NotRequired[str]]

    # This should generate an error because nested ReadOnly are not allowed.
    d: ReadOnly[ReadOnly[str]]


TD2 = TypedDict("TD2", {"a": ReadOnly[str]}, total=True, readonly=True)
TD3 = TypedDict("TD3", {"a": ReadOnly[str]}, readonly=False, total=True)

# This should generate an error because readonly accepts only bool literals.
TD4 = TypedDict("TD4", {"a": ReadOnly[str]}, total=True, readonly=1)

# This should generate an error because TypedDict doesn't accept additional parameters.
TD5 = TypedDict("TD5", {"a": ReadOnly[str]}, total=True, readonly=True, foo=1)


class F1(TypedDict):
    a: Required[int]


class F2(F1, readonly=True):
    # This should generate an error because it is redefined as read-only.
    a: int


class F3(F1):
    # This should generate an error because it is redefined as read-only.
    a: ReadOnly[int]
