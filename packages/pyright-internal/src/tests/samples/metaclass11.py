# This sample verifies that the type checker allows access
# to instance variables provided by a metaclass.

from typing import Any


class MetaA(type):
    var0 = 3

    def __init__(cls, name, bases, dct):
        cls.var1 = "hi"


class ClassA(metaclass=MetaA):
    pass


# This should generate an error because var0 isn't
# accessible via an instance of this class.
ClassA().var0
reveal_type(ClassA.var0, expected_text="int")
ClassA.var0 = 1

reveal_type(ClassA().var1, expected_text="str")
reveal_type(ClassA.var1, expected_text="str")

ClassA.var1 = "hi"
ClassA().var1 = "hi"


class MetaB(type):
    def __setattr__(cls, key: str, value: Any) -> None: ...


class ClassB(metaclass=MetaB):
    var0: int


# This should generate an error
ClassB.var0 = ""
ClassB.var1 = ""

ClassB().var0 = 1

# This should generate an error
ClassB().var0 = ""

# This should generate an error
ClassB().var1 = ""
