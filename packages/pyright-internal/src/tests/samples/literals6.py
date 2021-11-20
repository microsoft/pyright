# This sample tests various illegal forms of Literal.

from typing import Any, Literal, TypeVar
from pathlib import Path

# This should generate an error.
Wrong1 = Literal[3 + 4]

# This should generate an error.
Wrong2 = Literal["foo".replace("o", "b")]

# This should generate an error.
Wrong3 = Literal[4 + 3j]

# This should generate an error.
Wrong4 = Literal[-4 + 2j]

# This should generate an error.
Wrong5 = Literal[(1, "foo", "bar")]

# This should generate an error.
Wrong6 = Literal[{"a": "b", "c": "d"}]

# This should generate an error.
Wrong7 = Literal[Path("abcd")]
T = TypeVar("T")

# This should generate an error.
Wrong8 = Literal[T]

# This should generate an error.
Wrong9 = Literal[3.14]

# This should generate an error.
Wrong10 = Literal[Any]

# This should generate an error.
Wrong11 = Literal[...]


def func():
    ...


# This should generate an error.
Wrong12 = Literal[func]
some_variable = "foo"

# This should generate an error.
Wrong13 = Literal[some_variable]


# This should generate an error.
var1: Literal[3 + 4]

# This should generate an error.
var2: Literal["foo".replace("o", "b")]

# This should generate an error.
var3: Literal[4 + 3j]

# This should generate an error.
var4: Literal[-4 + 2j]

# This should generate an error.
var5: Literal[(1, "foo", "bar")]

# This should generate an error.
var6: Literal[{"a": "b", "c": "d"}]

# This should generate an error.
var7: Literal[Path("abcd")]

# This should generate an error.
var8: Literal[T]

# This should generate an error.
var9: Literal[3.14]

# This should generate an error.
var10: Literal[Any]

# This should generate an error.
var11: Literal[...]

# This should generate an error.
var12: Literal[func]

# This should generate an error.
var13: Literal[some_variable]
