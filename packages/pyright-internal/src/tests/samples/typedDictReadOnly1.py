# This sample tests error conditions for TypedDict classes with
# read-only entries as introduced in PEP 705.

# pyright: reportIncompatibleVariableOverride=true

from typing import NotRequired, Required, TypedDict
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]


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
    b: ReadOnly[NotRequired[int]]
    c: ReadOnly[Required[int]]


class F3(F1):
    # This should generate an error because it is redefined as read-only.
    a: ReadOnly[int]


class F4(F1):
    # This should generate an error because it is redefined as not required.
    a: NotRequired[int]


class F5(F1):
    b: ReadOnly[Required[int]]


class F6(F1):
    # This should generate an error because a "not required" field can't
    # override a "required" field.
    c: ReadOnly[NotRequired[int]]
