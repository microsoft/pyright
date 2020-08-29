# This sample tests the type checker's ability to do
# TypeVar matching for both constrained TypeVars and unconstrained.

from typing import TypeVar

S = TypeVar('S', str, bytes)

def constrained(first: S, second: S) -> S:
    return first

# This should generate an error because the two arguments
# cannot satisfy the 'str' or 'bytes' constraint.
result = constrained('a', b'abc')

T = TypeVar('T')

def unconstrained(first: T, second: T) -> T:
    return first

# This shouldn't generate an error because the TypeVar matching
# logic is free to expand the type to a union of 'str' and 'bytes'.
result = unconstrained('a', b'abc')
