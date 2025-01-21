# This sample tests the isinstance type narrowing involving TypeForm types.

# pyright: reportMissingModuleSource=false

from types import UnionType
from typing import Any
from typing_extensions import TypeForm


def func1(tf1: TypeForm[Any]):
    if isinstance(tf1, UnionType):
        reveal_type(tf1, expected_text="UnionType")
    else:
        reveal_type(tf1, expected_text="TypeForm[Any]")

    reveal_type(tf1, expected_text="UnionType | TypeForm[Any]")


def func2():
    # This should generate an error.
    if isinstance(1, TypeForm):
        pass
