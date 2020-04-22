# This sample tests type checking support for "Literal"

from typing import Literal

ValidResponses = Literal["a", b"b", "c" "c", True, None]


def foo(a: ValidResponses):
    pass


foo("a")
foo(b"b")
foo("cc")
foo(True)
foo(None)

# This should generate an error because 'b'
# isn't a valid literal value.
foo("b")

# This should generate an error because 'cc'
# isn't a valid literal value.
foo("c")

# This should generate an error because False
# isn't a valid literal value.
foo(False)

# This should generate an error because 3
# isn't a valid literal value.
foo(3)


# This should generate an error because floats
# cannot be used as literals.
invalidType = 3  # type: Literal[3.4]

# This should generate an error because 2
# is not a valid literal value.
mismatch = 2  # type: Literal[3, 4, '5']
