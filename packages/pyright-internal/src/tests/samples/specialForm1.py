# This sample tests the case where the special-form aliases for
# the stdlib collection classes are instantiated.

# This should generate an error.
from typing import Dict, List, Set, Tuple

# This should generate an error.
t1 = Dict()

# This should generate an error.
t2 = List()

# This should generate an error.
t3 = Set()

# This should generate an error.
t4 = Tuple()
