# This sample tests the type analyzer's type narrowing logic for
# conditions of the form "X is None", "X is not None",
# "X == None" and "X != None".

# pyright: strict

from typing import Optional

def func1(x: Optional[int]):
    if x is not None:
        x.bit_length()

    if x != None:
        x.bit_length()

    if x is None:
        pass
    else:
        x.bit_length()
    
    if x == None:
        pass
    else:
        x.bit_length()


