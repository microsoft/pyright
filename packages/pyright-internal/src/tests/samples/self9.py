# This sample tests the case where a parent class defines a class variable
# that uses Self and a child class accesses this through self or cls.

from typing import Self


class ParentA:
    a: list[Self]


class ChildA(ParentA):
    b: int

    @classmethod
    def method1(cls) -> None:
        reveal_type(cls.a, expected_text="list[Self@ChildA]")
        reveal_type(cls.a[0], expected_text="Self@ChildA")
        print(cls.a[0].b)

    def method2(self) -> None:
        reveal_type(self.a, expected_text="list[Self@ChildA]")
        reveal_type(self.a[0], expected_text="Self@ChildA")
        print(self.a[0].b)
