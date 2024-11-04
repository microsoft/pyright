# This sample tests the type checker's validation
# of the __init_subclass__ method described in
# PEP 487.

from datetime import datetime
from typing import Any, Optional, Type, TypedDict


class ClassA:
    def __init_subclass__(
        cls, *, param1: str, param2: float, param3: Optional[Any] = None
    ) -> None:
        super().__init_subclass__()


# This should generate two errors because param1 is
# the wrong type.
class ClassB(ClassA, param1=0, param2=4):
    pass


# This should generate two errors because param2 is missing.
class ClassC(ClassA, param1="0", param3=datetime.now()):
    pass


class ClassD(ClassA, param1="0", param2=5.0):
    pass


class ClassE:
    def __init_subclass__(cls, *, arg: int) -> None:
        func1(cls, arg)

    def __new__(cls) -> "ClassE":
        func1(cls, 9)
        return super().__new__(cls)


def func1(klass: Type[ClassE], arg: int):
    pass


class ClassF(ClassA, param1="hi", param2=3.4):
    def __init_subclass__(cls, param_alt1: int):
        super().__init_subclass__(param1="yo", param2=param_alt1)


def func2(cls):
    pass


class ClassG:
    __init_subclass__ = func2


class ClassH(ClassG):
    pass


# This should generate two errors because "a" is not present
# in the object.__init_subclass__ method.
class ClassI(a=3):
    a: int


class ClassJ:
    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        cls.custom_attribute = 9


class ClassJChild(ClassJ):
    def __init__(self):
        reveal_type(self.custom_attribute, expected_text="int")
