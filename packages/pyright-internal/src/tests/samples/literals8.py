# This sample tests that diagnostic formatting preserves dollar signs in literals.

from typing import Literal


# These assignments should generate errors with the literal text preserved.
x1: Literal["a$&b"] = "c"
x2: Literal["a$$b"] = "c"
x3: Literal["a$`b"] = "c"
x4: Literal["a$'b"] = "c"
x5: Literal["a$b"] = "c"
x6: Literal["plain"] = "c"

# Matching literals should remain valid.
valid1: Literal["a$&b"] = "a$&b"
valid2: Literal["a$$b"] = "a$$b"
valid3: Literal["plain"] = "plain"

reveal_type(valid1, expected_text="Literal['a$&b']")
