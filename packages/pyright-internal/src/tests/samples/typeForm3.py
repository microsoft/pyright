# This sample tests inference behaviors related to TypeForm.

# pyright: strict

from types import GenericAlias
from enum import member
from typing import Pattern, TypeGuard
from typing_extensions import TypeForm, TypeIs
from warnings import catch_warnings


def func1():
    return "int | str"


reveal_type(func1(), expected_text="Literal['int | str']")


def func2():
    return int | str


reveal_type(func2(), expected_text="UnionType")


v1 = [int | str, str | bytes]
reveal_type(v1, expected_text="list[UnionType]")

v2 = {int | str, str | bytes}
reveal_type(v2, expected_text="set[UnionType]")

v3 = {int | str: str | bytes}
reveal_type(v3, expected_text="dict[UnionType, UnionType]")

v4: GenericAlias = list[int]

# These should generate errors because typing special forms don't produce
# types.GenericAlias objects at runtime.
v5: GenericAlias = TypeGuard[int]
v6: GenericAlias = TypeIs[int]
v7: GenericAlias = TypeForm[int]
v8: GenericAlias = catch_warnings[None]
v9: GenericAlias = member[int]
v10: GenericAlias = Pattern[str]
