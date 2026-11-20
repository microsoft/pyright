# This sample verifies the runtime attributes exposed by the PEP 728
# implementation in typing_extensions on Python 3.14.

from typing import assert_type
from typing_extensions import NoExtraItems, TypedDict  # pyright: ignore[reportMissingModuleSource]


class OpenRecord(TypedDict):
    name: str


class ClosedRecord(TypedDict, closed=True):
    name: str


class ExtraRecord(TypedDict, extra_items=int):
    name: str


FunctionalRecord = TypedDict("FunctionalRecord", {"name": str}, closed=True)

assert_type(OpenRecord.__closed__, bool | None)
assert OpenRecord.__extra_items__ is NoExtraItems
assert ClosedRecord.__closed__ is True
assert ExtraRecord.__extra_items__ is int
assert FunctionalRecord.__closed__ is True
