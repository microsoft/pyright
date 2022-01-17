# This sample tests the special case of the tuple() constructor
# when used with bidirectional type inference.

from typing import Tuple


tuple1: Tuple[int, ...] = tuple()
reveal_type(tuple1, expected_text="tuple[int, ...]")

tuple2: Tuple[str, int, complex] = tuple()
reveal_type(tuple2, expected_text="tuple[str, int, complex]")
