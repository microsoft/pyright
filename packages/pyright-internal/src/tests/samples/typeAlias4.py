# This sample tests the handling of the Python 3.9
# TypeAlias feature as documented in PEP 613.

from typing import Type, TypeAlias as TA, Union

type1: TA = Union[int, str]

type2: TA = "ClassA"


class ClassA:
    pass


not_a_type = "ClassA"


def requires_string(a: str):
    pass


requires_string(not_a_type)

# This should generate an error because type2 should
# not be interpreted as a string.
requires_string(type2)

# This should generate an error because the symbol
# is later declared as a TypeAlias.
my_type3 = int

my_type3: TA = Union[int, str]

# This should generate an error because the symbol
# was previously declared as a TypeAlias.
my_type3: TA = int

# This should generate an error because the expression
# on the RHS evaluates to an object, not a class.
my_type4: TA = 3

# This should generate an error because the expression
# on the RHS evaluates to an object, not a class.
my_type5: TA = True

# This should generate an error because the expression
# on the RHS evaluates to an object, not a class.
my_type7: TA = list()

# Verify that variables with declarations (other than explicit TypeAlias)
# are not treated as a type alias.
SimpleAlias = int
ExplicitAlias: TA = int
SimpleNonAlias: Type[int] = int

reveal_type(SimpleAlias, expected_text="Type[int]")
reveal_type(ExplicitAlias, expected_text="Type[int]")
reveal_type(SimpleNonAlias, expected_text="Type[int]")


class ClassB:
    my_type1: TA = int


def func1():
    # This should generate an error because type aliases are allowed
    # only in classes or modules.
    my_type1: TA = int
