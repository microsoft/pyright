# This sample tests the case where a property's getter and setter
# are defined in different classes.

# pyright: reportIncompatibleMethodOverride=false

from typing import Generic, Self, TypeVar


T = TypeVar("T")


class Parent(Generic[T]):
    @property
    def prop1(self) -> T: ...

    @property
    def prop2(self) -> Self: ...


class Child(Parent[str]):
    @Parent.prop1.setter
    def prop1(self, value: str) -> None: ...

    @Parent.prop2.setter
    def prop2(self, value: str) -> None: ...


parent = Parent[int]()
reveal_type(parent.prop1, expected_text="int")
reveal_type(parent.prop2, expected_text="Parent[int]")

# This should generate an error because there is no setter
# on the parent's property.
parent.prop1 = ""

child = Child()
reveal_type(child.prop1, expected_text="str")
reveal_type(child.prop2, expected_text="Child")

child.prop1 = ""
