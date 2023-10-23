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


TD2 = TypedDict("TD2", {"a": ReadOnly[str]}, total=True)
TD3 = TypedDict("TD3", {"a": ReadOnly[str]}, total=True)


class F1(TypedDict):
    a: Required[int]


class F3(F1):
    # This should generate an error because it is redefined as read-only.
    a: ReadOnly[int]
