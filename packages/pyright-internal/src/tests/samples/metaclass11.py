# This sample verifies that the type checker allows access
# to instance variables provided by a metaclass.

from enum import Enum
from typing import Mapping


class Meta(type):
    var0 = 3

    def __init__(cls, name, bases, dct):
        cls.var1 = "hi"


class MyClass(metaclass=Meta):
    pass


# This should generate an error because var0 isn't
# accessible via an instance of this class.
MyClass().var0
reveal_type(MyClass.var0, expected_text="int")
MyClass.var0 = 1

reveal_type(MyClass().var1, expected_text="str")
reveal_type(MyClass.var1, expected_text="str")

MyClass.var1 = "hi"
MyClass().var1 = "hi"
