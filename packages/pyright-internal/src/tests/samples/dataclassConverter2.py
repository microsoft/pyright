# This sample tests assignment of dataclass fields that use
# the converter parameter described in PEP 712.

from dataclasses import dataclass, field
from enum import Enum
from typing import dataclass_transform


def converter_simple(s: str) -> int:
    ...


def converter_passThru(x: str | int) -> str | int:
    ...


@dataclass
class DC1:
    # This should generate an error because "converter" is not an official property yet.
    asymmetric: int = field(converter=converter_simple)
    # This should generate an error because "converter" is not an official property yet.
    symmetric: str | int = field(converter=converter_passThru)


dc1 = DC1("1", 1)

reveal_type(dc1.asymmetric, expected_text="int")
dc1.asymmetric = "2"
reveal_type(
    dc1.asymmetric, expected_text="int"
)  # Asymmetric -- type narrowing should not occur
# This should generate an error because only strs can be assigned to field0.
dc1.asymmetric = 2

reveal_type(dc1.symmetric, expected_text="str | int")
dc1.symmetric = "1"
reveal_type(
    dc1.symmetric, expected_text="Literal['1']"
)  # Symmetric -- type narrowing should occur


reveal_type(DC1.asymmetric, expected_text="int")
DC1.asymmetric = "2"
reveal_type(DC1.asymmetric, expected_text="int")
# This should generate an error because only strs can be assigned to field0.
DC1.asymmetric = 2

reveal_type(DC1.symmetric, expected_text="str | int")
DC1.symmetric = "1"
reveal_type(DC1.symmetric, expected_text="Literal['1']")
