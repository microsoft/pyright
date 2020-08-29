# This sample tests the reportIncompatibleVariableOverride
# configuration option.

from typing import Union
from abc import ABC, abstractmethod

class ParentClass(ABC):
    var1: int
    var2: str
    var3: Union[int, str]
    var4: int
    var5: int

    @property
    def property1(self) -> int:
        return 1
    
    @property
    def property2(self) -> int:
        return 1

    @property
    def property3(self) -> int:
        return 1

    @property
    def property4(self) -> Union[str, int]:
        return 1

    @property
    @abstractmethod
    def property5(self) -> int:
        raise NotImplementedError()


class Subclass(ParentClass):
    # This should generate an error because the type is incompatible.
    var1: str

    var2: str

    var3: int

    # This should generate an error because the type is incompatible.
    var4 = ""

    var5 = 5

    # This should generate an error because a
    # property object is different from a simple
    # variable.
    property1: int

    @property
    def property2(self) -> int:
        return 3

    # This should generate an error because it is
    # an incompatible property.
    @property
    def property3(self) -> str:
        return ""

    @property
    def property4(self) -> int:
        return 1

    @property
    def property5(self) -> int:
        return 4
