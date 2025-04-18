# This sample tests basic scoping rules for refinement variables.

# pyright: reportMissingModuleSource=false

from typing_extensions import IntValue, StrValue

def func_good1(a: int @ IntValue("x"), b: str @ IntValue("x")) -> None:
    pass

# This should generate an error because "x" is used twice
# and has inconsistent types.
def func_bad1(a: int @ IntValue("x"), b: str @ StrValue("x")) -> None:
    pass

def outer1(a: int @ IntValue("x")):
    # This should generate an error because "x"
    # has inconsistent types.
    def inner(a: str @ StrValue("x")):
        pass
    
    v1: int @ IntValue("x")

    # This should generate an error because "x"
    # has inconsistent types.
    v2: str @ StrValue("x")


