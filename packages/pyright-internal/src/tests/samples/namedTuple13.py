# This sample tests that field types in the functional form of NamedTuple
# are validated as type expressions.

from typing import Annotated, Literal, NamedTuple, Required, assert_type


# This should generate an error because Annotated requires metadata.
N1 = NamedTuple("N1", [("x", Annotated[int])])

# This should generate an error because list accepts only one type argument.
N2 = NamedTuple("N2", [("x", list[int, str])])

# This should generate an error because 3 is not a type.
N3 = NamedTuple("N3", [("x", 3)])

# This should generate an error because a float is not a legal Literal parameter.
N4 = NamedTuple("N4", [("x", Literal[3.14])])

# This should generate an error because Required is allowed only in a TypedDict.
N7 = NamedTuple("N7", [("x", Required[int])])

N5 = NamedTuple("N5", [("x", Annotated[int, "m"])])
reveal_type(N5(1).x, expected_text="int")

N6 = NamedTuple("N6", [("x", Literal[1])])
reveal_type(N6(1).x, expected_text="Literal[1]")

N8 = NamedTuple("N8", [("x", str), ("y", "int")])
reveal_type(N8("a", 1).x, expected_text="str")
reveal_type(N8("a", 1).y, expected_text="int")

# A string field type can contain a recursive forward reference.
N9 = NamedTuple("N9", [("next", "N9 | None")])
reveal_type(N9(None).next, expected_text="N9 | None")
assert_type(N9(None).next, N9 | None)
