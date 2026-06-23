# This sample tests the static evaluation of literal truthiness

from typing import Literal, assert_type


# The literal condition is statically known
def positive() -> None:
    x: int

    while not 1:
        x = "unreachable"

    # Falsy literals
    if 0:
        x = "unreachable"

    if 0.0:
        x = "unreachable"

    if 0j:
        x = "unreachable"

    if "":
        x = "unreachable"

    if b"":
        x = "unreachable"

    if ():
        x = "unreachable"

    if []:
        x = "unreachable"

    if {}:
        x = "unreachable"

    if None:
        x = "unreachable"

    # Truthy literals
    if 1:
        x = 1
    else:
        x = "unreachable"

    if "x":
        x = 1
    else:
        x = "unreachable"

    if b"ad":
        x = 1
    else:
        x = "unreachable"

    if (1,):
        x = 1
    else:
        x = "unreachable"

    if [1]:
        x = 1
    else:
        x = "unreachable"

    if {1}:
        x = 1
    else:
        x = "unreachable"

    if {1: 2}:
        x = 1
    else:
        x = "unreachable"

    if ...:
        x = 1
    else:
        x = "unreachable"

    # Boolean operators applied to literal operands
    if 1 and 0:
        x = "unreachable"

    if 0 or "x":
        x = 1
    else:
        x = "unreachable"

    if not 1:
        x = "unreachable"

    if not []:
        x = 1
    else:
        x = "unreachable"

    if not not 1:
        x = 1
    else:
        x = "unreachable"


# The literal truthiness is not statically determinable
# Both branches are analyzed and the incompatible assignment is reported as an error
def negative(items: list[int], text: str, mapping: dict[str, int]) -> None:
    v: int

    # An unpacked element may expand to nothing, so `[*items]` may be empty
    if [*items]:
        v = "error"
    else:
        v = 1

    # The value of an f-string with a field depends on a runtime value
    if f"{text}":
        v = "error"
    else:
        v = 1

    # A comprehension may yield nothing
    if [i for i in items]:
        v = "error"
    else:
        v = 1

    # A dict built only from "**" expansion may be empty
    if {**mapping}:
        v = "error"
    else:
        v = 1


# `not` always forces a truthiness context
def strict_not_folding() -> None:
    a = not None
    assert_type(a, Literal[True])

    b = not 0
    assert_type(b, Literal[True])

    c = not 1
    assert_type(c, Literal[False])

    d = not []
    assert_type(d, Literal[True])

    e = not not None
    assert_type(e, Literal[False])
