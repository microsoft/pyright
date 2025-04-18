# This sample tests refinement condition validation.

# pyright: reportMissingModuleSource=false

from typing import Any, cast
from typing_extensions import StrValue


type SingleDigitIt = int @ "x if x >= 0 and x < 10"

x1: SingleDigitIt = 0
x2: SingleDigitIt = 9

# This should generate an error.
x3: SingleDigitIt = 10

# This should generate an error.
x4: SingleDigitIt = -1


def func1(a: int @ "x if x >= 0", b: int @ "y if y < 0 and x + y < 2") -> int:
    return a + b


func1(1, -1)
func1(10, -9)

# This should generate an error.
func1(1, 0)

# This should generate an error.
func1(10, -2)


def func2(a: int @ "x", b: int @ "y if x + y < 2") -> int @ "x":
    result = a + b
    reveal_type(result, expected_text='int @ "x + y"')
    return cast(Any, result)


func2(1, -1)
func2(10, -9)

# This should generate an error.
func2(1, 4)

# This should generate an error.
func2(10, -2)


y1: str @ StrValue("x if x == 'hi' or x == 'bye'") = "bye"
y1 = "hi"

# This should generate an error.
y1 = "neither"
