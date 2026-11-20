# This sample tests reads and unsafe mutations using a LiteralString key
# whose value is not known statically.

from typing import Literal, LiteralString, TypedDict, reveal_type
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]


class TD1(TypedDict, extra_items=str):
    known: int


class TD2(TypedDict):
    known: int


class TD3(TypedDict, closed=True):
    known: int


class TDReadOnly(TypedDict):
    protected: ReadOnly[int]


class TDMixed(TypedDict, extra_items=int | str):
    value: int | str


def func1(
    td1: TD1,
    td2: TD2,
    td3: TD3,
    readonly: TDReadOnly,
    mixed: TDMixed,
    plain_dict: dict[str, int],
    k: LiteralString,
    s: str,
    lit: Literal["known"],
) -> None:
    reveal_type(td1[k], expected_text="Unknown")
    reveal_type(td1[s], expected_text="Unknown")
    reveal_type(td2[k], expected_text="Unknown")
    reveal_type(td3[k], expected_text="Unknown")
    reveal_type(td1[lit], expected_text="int")
    reveal_type(readonly["protected"], expected_text="int")

    td1[lit] = 1
    known: LiteralString = "known"
    td1[known] = 1
    plain_dict[k] = 1
    del plain_dict[k]

    td1[k] = "a"  # This should generate an error.
    td2[k] = 1  # This should generate an error.
    td3[k] = 1  # This should generate an error.

    del td1[k]  # This should generate an error.
    del td2[k]  # This should generate an error.
    del td3[k]  # This should generate an error.

    readonly[k] = 1  # This should generate an error.
    del readonly[k]  # This should generate an error.

    if isinstance(mixed["value"], str):
        mixed[k] = 1  # This should generate an error.

    td2[k] += 1  # This should generate an error.

    td3["other"]  # This should generate an error.
    td1["known"] = "a"  # This should generate an error.
    del td1["known"]  # This should generate an error.
