# This sample tests the creation of tuples from unpacked values.

from typing import Literal, Any, Tuple

def foo() -> Tuple[Literal[1], Literal[2], Literal[3]]:
    rest = (2, 3)
    t = 1, *rest
    return t
    
def foo2() -> Tuple[Literal[1], Literal[2], Literal[3]]:
    rest = (3, 4)
    t = 1, 2, *rest
    # This should generate an error
    return t
    
def foo3() -> Tuple[Any, ...]:
    rest = [1, 2, 3]
    t = 1, 2, 3, *rest
    return t
    
