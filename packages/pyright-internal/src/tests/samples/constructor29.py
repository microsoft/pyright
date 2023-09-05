# This sample tests the case where a constructor for a generic class is
# called with a bidirectional type inference context that includes a union
# of multiple types that could apply.

from typing import Mapping


d1: dict[str, str] | dict[int, int] = dict()
reveal_type(d1, expected_text="dict[int, int]")

d2: dict[int, int] | dict[str, str] = dict()
reveal_type(d2, expected_text="dict[int, int]")

d3: Mapping[int, int] | Mapping[str, str] | int | float = dict()
reveal_type(d3, expected_text="dict[int, int]")

d4: dict[str, str] | dict[int, int] = dict(a="hi")
reveal_type(d4, expected_text="dict[str, str]")
