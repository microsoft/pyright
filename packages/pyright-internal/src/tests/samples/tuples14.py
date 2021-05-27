# This sample tests the special case of the tuple() constructor
# when used with bidirectional type inference.

from typing import Literal, Tuple


tuple1: Tuple[int, ...] = tuple()
t1: Literal["tuple[int, ...]"] = reveal_type(tuple1)

tuple2: Tuple[str, int, complex] = tuple()
t2: Literal["tuple[str, int, complex]"] = reveal_type(tuple2)
