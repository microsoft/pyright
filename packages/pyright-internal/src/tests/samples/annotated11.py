# This sample tests that member access on an Annotated alias is not
# delegated to the origin when the runtime alias wouldn't delegate it.

from typing import Annotated, ClassVar, Literal, TypeAliasType


class C:
    value: ClassVar[int] = 1


# The runtime origin is a TypeAliasType object, not C.
Explicit = TypeAliasType("Explicit", C)
A1 = Annotated[Explicit, "meta"]

# This should generate an error.
A1.value

# The runtime origin is a ForwardRef, not C.
A2 = Annotated["C", "meta"]

# This should generate an error.
A2.value

# The runtime origin is a Literal alias, not int.
A3 = Annotated[Literal[1], "meta"]

# This should generate an error.
A3.bit_length()

type Modern = C
A4 = Annotated[Modern, "meta"]

# This should generate an error.
A4.value

# Dunder attributes are not delegated to the origin.
A5 = Annotated[int, "meta"]

# This should generate an error.
A5.__add__(1, 2)

A6 = Annotated[C, "meta"]

# This should generate an error because deletion is not delegated.
del A6.value

# This should generate a single error.
A6.value = "not an int"

# A PEP 695 alias of Annotated is a TypeAliasType object at runtime.
type A7 = Annotated[C, "meta"]

# This should generate an error.
A7.value


class Integer:
    value: int = 1
    only_integer: int = 2


class Text:
    value: str = "text"


IntAlias = Annotated[Integer, "meta"]
TextAlias = Annotated[Text, "meta"]


def choose(flag: bool) -> int:
    alias = IntAlias if flag else TextAlias

    # This should generate an error.
    alias.value

    # This should generate an error.
    return alias.only_integer
