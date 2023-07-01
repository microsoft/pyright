# This sample tests the handling of bidirectional type inference
# for unions of tuples.

# The following two unions are the same but declared in different orders.
TupleUnion1 = tuple[int, str] | tuple[int, str, dict[str, str | int]]
TupleUnion2 = tuple[int, str, dict[str, str | int]] | tuple[int, str]

v1: TupleUnion1 = 1, "two", {"hey": "three"}
v2: TupleUnion2 = 1, "two", {"hey": "three"}
v3: TupleUnion1 = 1, "two"
v4: TupleUnion2 = 1, "two"
