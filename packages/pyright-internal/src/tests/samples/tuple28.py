from types import NotImplementedType
from typing import assert_type


class Declines:
    def __lt__(self, other: "Declines") -> NotImplementedType:
        return NotImplemented

    def __le__(self, other: "Declines") -> NotImplementedType:
        return NotImplemented

    def __gt__(self, other: "Declines") -> NotImplementedType:
        return NotImplemented

    def __ge__(self, other: "Declines") -> NotImplementedType:
        return NotImplemented


class TextResult:
    def __lt__(self, other: "TextResult") -> str:
        return "yes"

    def __le__(self, other: "TextResult") -> str:
        return "yes"

    def __gt__(self, other: "TextResult") -> str:
        return "yes"

    def __ge__(self, other: "TextResult") -> str:
        return "yes"


class BooleanResult:
    def __lt__(self, other: "BooleanResult") -> bool:
        return True

    def __le__(self, other: "BooleanResult") -> bool:
        return True

    def __gt__(self, other: "BooleanResult") -> bool:
        return True

    def __ge__(self, other: "BooleanResult") -> bool:
        return True


class ReflectedResult:
    def __lt__(self, other: "ReflectedResult") -> NotImplementedType:
        return NotImplemented

    def __le__(self, other: "ReflectedResult") -> NotImplementedType:
        return NotImplemented

    def __gt__(self, other: "ReflectedResult") -> bool:
        return True

    def __ge__(self, other: "ReflectedResult") -> bool:
        return True


def compare() -> None:
    _ = (Declines(), 0) < (Declines(), 1)  # This should generate an error.
    _ = ((Declines(),), 0) < ((Declines(),), 1)  # This should generate an error.
    _ = (Declines(), 0) <= (Declines(), 1)  # This should generate an error.
    _ = ((Declines(),), 0) <= ((Declines(),), 1)  # This should generate an error.
    _ = (Declines(), 0) > (Declines(), 1)  # This should generate an error.
    _ = ((Declines(),), 0) > ((Declines(),), 1)  # This should generate an error.
    _ = (Declines(), 0) >= (Declines(), 1)  # This should generate an error.
    _ = ((Declines(),), 0) >= ((Declines(),), 1)  # This should generate an error.
    _ = (TextResult(), 0) < (TextResult(), 1)  # This should generate an error.
    _ = ((TextResult(),), 0) < ((TextResult(),), 1)  # This should generate an error.
    _ = (TextResult(), 0) <= (TextResult(), 1)  # This should generate an error.
    _ = ((TextResult(),), 0) <= ((TextResult(),), 1)  # This should generate an error.
    _ = (TextResult(), 0) > (TextResult(), 1)  # This should generate an error.
    _ = ((TextResult(),), 0) > ((TextResult(),), 1)  # This should generate an error.
    _ = (TextResult(), 0) >= (TextResult(), 1)  # This should generate an error.
    _ = ((TextResult(),), 0) >= ((TextResult(),), 1)  # This should generate an error.
    assert_type((BooleanResult(), 0) < (BooleanResult(), 1), bool)
    assert_type(((BooleanResult(),), 0) < ((BooleanResult(),), 1), bool)
    assert_type((BooleanResult(), 0) <= (BooleanResult(), 1), bool)
    assert_type(((BooleanResult(),), 0) <= ((BooleanResult(),), 1), bool)
    assert_type((BooleanResult(), 0) > (BooleanResult(), 1), bool)
    assert_type(((BooleanResult(),), 0) > ((BooleanResult(),), 1), bool)
    assert_type((BooleanResult(), 0) >= (BooleanResult(), 1), bool)
    assert_type(((BooleanResult(),), 0) >= ((BooleanResult(),), 1), bool)
    assert_type((ReflectedResult(), 0) < (ReflectedResult(), 1), bool)
    assert_type(((ReflectedResult(),), 0) < ((ReflectedResult(),), 1), bool)
    assert_type((ReflectedResult(), 0) <= (ReflectedResult(), 1), bool)
    assert_type(((ReflectedResult(),), 0) <= ((ReflectedResult(),), 1), bool)
    assert_type((ReflectedResult(), 0) > (ReflectedResult(), 1), bool)
    assert_type(((ReflectedResult(),), 0) > ((ReflectedResult(),), 1), bool)
    assert_type((ReflectedResult(), 0) >= (ReflectedResult(), 1), bool)
    assert_type(((ReflectedResult(),), 0) >= ((ReflectedResult(),), 1), bool)


class Base0:
    def __lt__(self, other: "Base0") -> bool:
        return True


class Derived0(Base0):
    def __gt__(self, other: "Base0") -> str:
        return "yes"


_ = (Base0(), 0) < (Derived0(), 1)  # This should generate an error.
_ = ((Base0(),), 0) < ((Derived0(),), 1)  # This should generate an error.


class Base1:
    def __le__(self, other: "Base1") -> bool:
        return True


class Derived1(Base1):
    def __ge__(self, other: "Base1") -> str:
        return "yes"


_ = (Base1(), 0) <= (Derived1(), 1)  # This should generate an error.
_ = ((Base1(),), 0) <= ((Derived1(),), 1)  # This should generate an error.


class Base2:
    def __gt__(self, other: "Base2") -> bool:
        return True


class Derived2(Base2):
    def __lt__(self, other: "Base2") -> str:
        return "yes"


_ = (Base2(), 0) > (Derived2(), 1)  # This should generate an error.
_ = ((Base2(),), 0) > ((Derived2(),), 1)  # This should generate an error.


class Base3:
    def __ge__(self, other: "Base3") -> bool:
        return True


class Derived3(Base3):
    def __le__(self, other: "Base3") -> str:
        return "yes"


_ = (Base3(), 0) >= (Derived3(), 1)  # This should generate an error.
_ = ((Base3(),), 0) >= ((Derived3(),), 1)  # This should generate an error.


class MixedResult:
    def __lt__(self, other: "MixedResult") -> bool | NotImplementedType:
        return NotImplemented

    def __gt__(self, other: "MixedResult") -> bool:
        return True


assert_type((MixedResult(), 0) < (MixedResult(), 1), bool)
_ = ([Declines()], 0) < ([Declines()], 1)  # This should generate an error.
_ = ([TextResult()], 0) < ([TextResult()], 1)  # This should generate an error.
assert_type(([ReflectedResult()], 0) < ([ReflectedResult()], 1), bool)


class DecliningDerived(Base0):
    def __gt__(self, other: Base0) -> NotImplementedType:
        return NotImplemented


class TextBase:
    def __lt__(self, other: "TextBase") -> str:
        return "yes"


class BooleanDerived(TextBase):
    def __gt__(self, other: TextBase) -> bool:
        return True


assert_type((Base0(), 0) < (DecliningDerived(), 1), bool)
assert_type((TextBase(), 0) < (BooleanDerived(), 1), bool)
