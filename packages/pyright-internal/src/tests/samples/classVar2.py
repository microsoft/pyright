# This sample tests the type checker's handling of ClassVar
# used within a Protocol, as specified in PEP 544.

from typing import ClassVar, Protocol

class Proto(Protocol):
    var1: ClassVar[str]
    var2: ClassVar[str]

class ProtoImpl:
    var1 = ""

    def __init__(self) -> None:
        self.var2 = ""

# This should generate an error because var2
# is not a class variable.
a: Proto = ProtoImpl()
