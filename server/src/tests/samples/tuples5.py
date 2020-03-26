# This sample tests the type checker's handling of
# empty tuples and assignment to empty tuples.

from typing import Tuple

a: Tuple[()] = ()

# This should generate an error because the assigned
# tuple has one element, but the destination is
# expecting zero.
b: Tuple[()] = (1, )

# This should generate an error because the assigned
# tuple has zero elements, but the desintation is
# expecting two.
c: Tuple[int, str] = ()

