# This sample tests the handling of class properties, which
# are supported in Python 3.9 and newer.


from typing import Literal


class Class1:
    @classmethod
    @property
    def prop1(cls) -> str:
        return ""

    @classmethod
    @prop1.setter
    def prop1(cls, value: str):
        pass


t1: Literal["str"] = reveal_type(Class1.prop1)

t2: Literal["str"] = reveal_type(Class1().prop1)

Class1.prop1 = "hi"

# This should generate an error
Class1.prop1 = 1
