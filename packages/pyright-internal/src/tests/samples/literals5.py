# This sample tests literals that employ type aliases.

from typing import Literal, Union


Numeric = Literal[1, "3.4"]

DerivedLiteral1 = Literal["a", Numeric]

var1: DerivedLiteral1 = "3.4"

# This should generate an error.
var2: DerivedLiteral1 = "3.5"


NotNumeric = Union[Literal[1, 3], int]

# This should generate an error because NotNumeric
# isn't a legal literal.
DerivedLiteral2: Literal[NotNumeric, 3]


ReadOnlyMode = Literal["r", "r+"]
WriteAndTruncateMode = Literal["w", "w+", "wt", "w+t"]
WriteNoTruncateMode = Literal["r+", "r+t"]
AppendMode = Literal["a", "a+", "at", "a+t"]

AllModes = Literal[ReadOnlyMode, WriteAndTruncateMode, WriteNoTruncateMode, AppendMode]
