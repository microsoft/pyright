# This sample verifies that type narrowing for isinstance works
# on "self" and other bound TypeVars.


from typing import Self, TypeVar


class ClassA:
    def get_value(self) -> int:
        if isinstance(self, ChildB):
            return self.calculate()
        return 7


class ChildB(ClassA):
    def calculate(self) -> int:
        return 2 * 2


TC = TypeVar("TC")


class ClassC:
    @classmethod
    def test(cls: type[TC], id: int | TC):
        if isinstance(id, cls):
            reveal_type(id, expected_text="object*")
        else:
            reveal_type(id, expected_text="int | object*")


TD = TypeVar("TD", bound="ClassD")


class ClassD:
    @classmethod
    def test(cls: type[TD], id: int | TD):
        if isinstance(id, cls):
            reveal_type(id, expected_text="ClassD*")
        else:
            reveal_type(id, expected_text="int | ClassD*")


class ClassE:
    @classmethod
    def test(cls: type[Self], id: int | Self):
        if isinstance(id, cls):
            reveal_type(id, expected_text="Self@ClassE")
        else:
            reveal_type(id, expected_text="int | ClassE*")
