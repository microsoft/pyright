# This sample tests the assignment of heterogeneous tuples
# to homogeneous tuple types.

from typing import Tuple

def bar(values: Tuple[str, ...]): ...

# This should generate an error
bar(('', False))

# This should generate an error
bar((False, ''))

