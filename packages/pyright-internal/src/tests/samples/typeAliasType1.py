# This sample tests error cases for calls to the TypeAliasType constructor.

from typing import TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeAliasType,
)

# This should generate an error because arguments are missing.
TA1 = TypeAliasType()

# This should generate two errors because 1 isn't a legal name or str.
TA2 = TypeAliasType(1, int)

my_str = ""

# This should generate an error because my_str isn't a string literal.
TA3 = TypeAliasType(my_str, int)

# This should generate an error because name doesn't match.
TA4 = TypeAliasType("TA3", int)

# This should generate an error because it's not part of an assignment statement.
TypeAliasType("TA3", int)

# This should generate an error because it has an extra argument.
TA5 = TypeAliasType("TA5", int, x=3)

# This should generate an error because it has an extra argument.
TA6 = TypeAliasType("TA6", int, 3)

# This should generate two errors because type_params is not a tuple.
TA7 = TypeAliasType("TA7", int, type_params=[1])

# This should generate two errors because type_params is not a tuple of TypeVars.
TA8 = TypeAliasType("TA8", int, type_params=(int,))


S = TypeVar("S")
T = TypeVar("T")

# This should generate an error because S is not in scope.
TA9 = TypeAliasType("TA9", list[S], type_params=(T,))

my_tuple = (S, T)

# This should generate two errors because type_params is not a tuple expression.
TA10 = TypeAliasType("TA10", int, type_params=my_tuple)
print(TA10.__value__)


TA11 = TypeAliasType("TA11", int)
print(TA11.__value__)

type TA12 = int | str
print(TA12.__value__)

# This should generate an error.
TA13 = TypeAliasType("TA13", ...)


def func1():
    # This should generate an error.
    TA14 = TypeAliasType("TA14", int)
