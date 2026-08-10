# This sample tests realistic static conditions and counterexamples in TypedDict definitions.

import contextlib
import os
import sys as _sys
import typing as _typing
from typing import Generic, NotRequired, Required, TYPE_CHECKING, TypeVar, TypedDict, assert_type

from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]

# The test configuration overrides these values to select the enabled branches below.
ENABLE_FAST_PATH = False
FEATURE_SET = "legacy"
_T = TypeVar("_T")


class CompatibilityBase(TypedDict, total=False):
    inherited: int


class CompatibilityMetadata(CompatibilityBase, total=False):
    optional: NotRequired[str]

    if _sys.version_info >= (3, 13):
        minor_version: Required[str]
        payload: Required["Payload"]

    if _sys.version_info[0] == 3:
        major_version: Required[int]

    if _sys.platform == "linux":
        platform_name: Required[str]

    if os.name == "posix":
        os_name: Required[str]

    if TYPE_CHECKING:
        checker_only: Required[bool]

    if _typing.TYPE_CHECKING:
        qualified_checker_only: Required[bytes]

    if ENABLE_FAST_PATH:
        fast_path: Required[float]

    if FEATURE_SET == "modern":
        feature_set: Required[str]

    if _sys.version_info >= (3, 12):
        if _sys.platform == "linux":
            nested: Required[tuple[int, str]]


class Payload:
    pass


metadata = CompatibilityMetadata(
    minor_version="3.13",
    payload=Payload(),
    major_version=3,
    platform_name="linux",
    os_name="posix",
    checker_only=True,
    qualified_checker_only=b"checked",
    fast_path=1.0,
    feature_set="modern",
    nested=(1, "nested"),
)
assert_type(metadata["payload"], Payload)
assert_type(metadata.get("optional"), str | None)


class GenericEnvelope(TypedDict, Generic[_T], total=False):
    if _sys.version_info >= (3, 13):
        value: Required[_T]
        next: NotRequired["GenericEnvelope[_T]"]
        frozen: ReadOnly[_T]
    else:
        ignored: int = 1


envelope: GenericEnvelope[int] = {"value": 1, "frozen": 2}
assert_type(envelope["value"], int)

# This should generate an error because the selected field is read-only.
envelope["frozen"] = 3


class SelectedWireValue(TypedDict):
    if _sys.version_info < (3, 12):
        value: bytes
    elif _sys.version_info < (4, 0):
        value: str
    else:
        value: int


SelectedWireValue(value="")

# This should generate an error because Python 3.13 selects str.
SelectedWireValue(value=1)


class ForwardOrder(TypedDict):
    if _sys.version_info >= (3, 13):
        value: str
    else:
        value: bytes


class ReverseOrder(TypedDict):
    if _sys.version_info < (3, 13):
        value: bytes
    else:
        value: str


forward_order = ForwardOrder(value="")
reverse_order = ReverseOrder(value="")
assert_type(forward_order["value"], str)
assert_type(reverse_order["value"], str)

# These should generate errors. Equivalent conditions in different orders must select the same type.
ForwardOrder(value=b"")
ReverseOrder(value=b"")


def runtime_condition() -> bool:
    return True


class UnknownCondition(TypedDict):
    # This should generate an error because the condition cannot be evaluated statically.
    if runtime_condition():
        runtime: int


class InvalidControlFlow(TypedDict):
    # This should generate an error because while statements are not allowed.
    while False:
        while_field: int

    # This should generate an error because for statements are not allowed.
    for _ in ():
        for_field: int

    # This should generate an error because try statements are not allowed.
    try:
        try_field: int
    except Exception:
        except_field: int

    # This should generate an error because with statements are not allowed.
    with contextlib.nullcontext():
        with_field: int

    # This should generate an error because match statements are not allowed.
    match 1:
        case 1:
            match_field: int


class InvalidActiveStatements(TypedDict):
    # This should generate an error because assignments are not allowed.
    assignment: int = 1

    # This should generate an error because methods are not allowed.
    def method(self) -> None:
        pass


class DuplicateActiveField(TypedDict):
    if _sys.version_info >= (3, 13):
        duplicate: int

    # This should generate an error because the field is already active.
    duplicate: str


class IgnoredInactiveCode(TypedDict):
    active: int

    if _sys.version_info < (3, 13):
        inactive_assignment: int = 1

        def inactive_method(self) -> None:
            pass

        active: str

    if False:
        while False:
            inactive_loop: int


IgnoredInactiveCode(active=1)
