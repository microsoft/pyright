# This sample tests the reportIncompatibleVariableOverride
# configuration option.

from typing import List, Union


class ParentClass:
    var1: int
    var2: str
    var3: Union[int, str]
    var4: int
    var5: int
    var6: int
    var7: List[float]
    var8: List[int]
    
    _var1: int
    __var1: int


class Subclass(ParentClass):
    # This should generate an error because the type is incompatible.
    var1: str

    var2: str

    var3: int

    # This should generate an error because the type is incompatible.
    var4 = ""

    var5 = 5

    # This should generate an error because a property cannot override
    # a variable.
    @property
    def var6(self) -> int:
        return 3

    # This should not generate an error because the inherited (expected)
    # type of var7 is List[float], so the expression "[3, 4, 5]" should
    # be inferred as List[float] rather than List[int].
    var7 = [3, 4, 5]

    # This should generate an error because floats are not allowed
    # in a List[int].
    var8 = [3.3, 45.6, 5.9]

    # This should generate an error
    _var1: str

    # This should not generate an error because it's a private name
    __var1: str