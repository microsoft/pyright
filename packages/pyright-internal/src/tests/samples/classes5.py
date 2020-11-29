# This sample tests the reportIncompatibleVariableOverride
# configuration option.

from typing import Union


class ParentClass:
    var1: int
    var2: str
    var3: Union[int, str]
    var4: int
    var5: int
    var6: int


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
