# This sample tests the detection of keywords in a named tuple
# definition and support for the "rename" parameter.


from collections import namedtuple
from typing import NamedTuple


# This should generate an error because "def" is a keyword.
NT1 = namedtuple("NT1", ["abc", "def"])

# This should generate an error because "class" is a keyword.
NT2 = namedtuple("NT2", ["abc", "class"], rename=False)

NT3 = namedtuple("NT3", ["abc", "def"], rename=True)

v3 = NT3(abc=0, _1=0)

# This should generate an error because "def" is a keyword.
NT4 = NamedTuple("NT4", [("abc", int), ("def", int)])


# These are soft keywords, so they shouldn't generate an error.
NT5 = namedtuple("NT5", ["type", "match"])
