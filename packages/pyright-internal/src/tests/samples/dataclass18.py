# This sample tests the case where a "bare" Final is used in a dataclass
# with a default value.

from typing import Final
from dataclasses import dataclass


@dataclass
class DC1:
    a: Final = 1


v1 = DC1(1)
reveal_type(v1.a, expected_text="Literal[1]")

v2 = DC1()
reveal_type(v2.a, expected_text="Literal[1]")
