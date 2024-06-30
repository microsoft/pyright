# This sample tests the handling of class properties, which
# are supported in Python 3.9 and newer.


from typing import TypeVar


class Class1:
    @classmethod
    @property
    def prop1(cls) -> str:
        return ""

    @classmethod
    @prop1.setter
    def prop1(cls, value: str):
        pass


reveal_type(Class1.prop1, expected_text="str")
reveal_type(Class1().prop1, expected_text="str")

Class1.prop1 = "hi"

# This should generate an error.
Class1.prop1 = 1


T = TypeVar("T", bound="Class2")


class Class2:
    @classmethod
    @property
    def prop1(cls: type[T]) -> type[T]:
        return cls


class Class3(Class2): ...


reveal_type(Class2.prop1, expected_text="type[Class2]")
reveal_type(Class3.prop1, expected_text="type[Class3]")
