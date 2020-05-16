# This sample tests error conditions for ParameterSpecification (PEP 612).

from typing import Callable, List, ParameterSpecification, Tuple, cast


TParams = ParameterSpecification("TParams")

# This should generate an error because ParameterSpecifications
# can't be used as a type annotation.
def foo(a: TParams) -> int:
    return 1

a = 3

# This should generate an error.
b = cast(TParams, a)

# This should generate an error.
foo(1)

# This should generate an error.
c: List[TParams] = []

d: Callable[TParams, int]

# This should generate an error.
e: Callable[TParams, TParams]

# This should generate an error.
f: Callable[[TParams], int]

# This should generate an error.
g: Tuple[TParams]

