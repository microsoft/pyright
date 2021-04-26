# This sample tests that the type checker enforces that the
# assigned name of a TypeVar matches the name provided in
# the TypeVar itself.

from typing import Any, TypeVar

T1 = TypeVar("T1")

# This should generate an error because the TypeVar name
# does not match the name of the variable it is assigned to.
T2 = TypeVar("T3")

T4: Any = TypeVar("T4")

my_dict = {}

# This should generate an error because TypeVars cannot be
# assigned to an index expression.
my_dict["var"] = TypeVar("T5")

# This should generate an error because a TypeVar with a single
# constraint is an error.
T5 = TypeVar("T5", str)
