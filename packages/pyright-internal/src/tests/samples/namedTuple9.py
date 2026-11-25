# This sample tests the detection of keywords in a named tuple
# definition and support for the "rename" parameter.


from collections import namedtuple
from typing import Literal, NamedTuple, NotRequired, TypedDict


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


class RenameTrue(TypedDict):
    rename: Literal[True]


class RenameBool(TypedDict):
    rename: bool


class RenameNotRequired(TypedDict):
    rename: NotRequired[Literal[True]]


def func1(kwargs: RenameTrue):
    NT6 = namedtuple("NT6", ["abc", "def"], **kwargs)
    NT6(abc=0, _1=0)


def func2(kwargs: RenameBool):
    # This should generate an error because "def" is a keyword.
    namedtuple("NT7", ["abc", "def"], **kwargs)


def func3(kwargs: RenameNotRequired):
    # This should generate an error because "def" is a keyword.
    namedtuple("NT8", ["abc", "def"], **kwargs)
