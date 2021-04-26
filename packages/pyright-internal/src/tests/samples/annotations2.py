# This sample tests the parser and type checker's ability to use
# type annotations in comments following assignment expressions.
# These are used in some older typestub files because they're
# compatible with versions of Python before 3.6.

from typing import List, Optional, Tuple

a = 3  # type: int

b = "3"  # type: str

c = [1, 2, 3]  # type: Optional[List[int]]


# A type on the next line shouldn't be honored
d = "hello"
# type: int

# A type comment with a space between the type and
# the colon is also not honored.
e = "hello"  # type : int

# Neither is a capital "Type"
f = "hello"  # Type: int


# This should generate an error because the type doesn't match
g = "hello"  # type: int


# This should generate an error because the last entry
# of the tuple is the wrong type.
h = (1, "hello", (5,))  # type: Tuple[int, str, Tuple[str]]
