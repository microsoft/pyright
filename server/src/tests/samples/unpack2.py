# This sample tests the creation of tuples from unpacked values.

from typing import Any, Tuple

def foo() -> Tuple[int, int, int]:
    rest = (2, 3)
    t = 1, *rest
    return t
    
def foo2() -> Tuple[int, int, int]:
    rest = (3, 4)
    t = 1, 2, *rest
    # This should generate an error
    return t
    
def foo3() -> Tuple[Any, ...]:
    rest = [1, 2, 3]
    t = 1, 2, 3, *rest
    return t
    
