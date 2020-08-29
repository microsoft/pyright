# This sample tests the handling of the "yield from" statement
# and inferred return types from generators that use this
# statement.

from typing import Dict
def f():
    yield from [1, 2, 3]

def g():
    yield from f()

a: Dict[int, int] = {}
for i in g():
    a[i] = i
