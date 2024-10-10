# This sample tests various illegal forms of Literal.

from enum import Enum
from pathlib import Path
from typing import Any, Literal, TypeVar

Wrong1 = Literal[3 + 4]

Wrong2 = Literal["foo".replace("o", "b")]

Wrong3 = Literal[4 + 3j]

Wrong4 = Literal[-4 + 2j]

Wrong5 = Literal[(1, "foo", "bar")]

Wrong6 = Literal[{"a": "b", "c": "d"}]

Wrong7 = Literal[Path("abcd")]
T = TypeVar("T")

Wrong8 = Literal[T]

Wrong9 = Literal[3.14]

Wrong10 = Literal[Any]

Wrong11 = Literal[...]


def func(): ...


Wrong12 = Literal[func]
some_variable = "foo"

Wrong13 = Literal[some_variable]


# This should generate two errors.
var1: Literal[3 + 4]

# This should generate two errors.
var2: Literal["foo".replace("o", "b")]

# This should generate two errors.
var3: Literal[4 + 3j]

# This should generate three errors.
var4: Literal[-4 + 2j]

# This should generate an error.
var5: Literal[(1, "foo", "bar")]

# This should generate an error.
var6: Literal[{"a": "b", "c": "d"}]

# This should generate two errors.
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

# This should generate two errors.
var13: Literal[some_variable]


class Enum1(Enum):
    A = 1
    B = 2

    x: str


a = Enum1.A

# This should generate two errors.
var14: Literal[a]

# This should generate two errors.
var15: Literal[Enum1.x]
