# This sample tests the handling of bidirectional type inference
# for unions of tuples.

from typing import Dict, Tuple, Union


# The following two unions are the same but declared in different orders.
TupleUnion1 = Union[Tuple[int, str], Tuple[int, str, Dict[str, Union[str, int]]]]
TupleUnion2 = Union[Tuple[int, str, Dict[str, Union[str, int]]], Tuple[int, str]]

v1: TupleUnion1 = 1, "two", {"hey": "three"}
v2: TupleUnion2 = 1, "two", {"hey": "three"}
v3: TupleUnion1 = 1, "two"
v4: TupleUnion2 = 1, "two"
