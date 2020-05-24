# This sample tests the handling of the Python 3.9
# TypeAlias feature as documented in PEP 613.

from typing import TypeAlias, Union

type1: TypeAlias = Union[int, str]

type2: TypeAlias = "ClassA"

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

my_type3: TypeAlias = Union[int, str]

# This should generate an error because the symbol
# was previously declared as a TypeAlias.
my_type3: TypeAlias = int

# This should generate an error because the expression
# on the RHS evaluates to an object, not a class.
my_type4: TypeAlias = 3

# This should generate an error because the expression
# on the RHS evaluates to an object, not a class.
my_type5: TypeAlias = True

# This should generate an error because the expression
# on the RHS evaluates to an object, not a class.
my_type7: TypeAlias = list()
