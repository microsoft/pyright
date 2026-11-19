# This sample tests member access on a class object whose metaclass
# defines a descriptor. A class is an instance of its metaclass, so a
# data descriptor on the metaclass overrides an attribute of the same
# name in the class's namespace, and an attribute in the class's
# namespace overrides a non-data descriptor. This includes descriptors
# declared on `type`, since `type` is its own metaclass.

from typing import Any, ClassVar, Self, overload


class Get:
    def __get__(self, obj: object, owner: Any) -> int: ...


class GetSet:
    def __get__(self, obj: object, owner: Any) -> int: ...
    def __set__(self, obj: object, value: int) -> None: ...


class GetDelete:
    def __get__(self, obj: object, owner: Any) -> int: ...
    def __delete__(self, obj: object) -> None: ...


class GetSetDelete:
    @overload
    def __get__(self, obj: None, owner: Any) -> Self: ...
    @overload
    def __get__(self, obj: object, owner: Any) -> int: ...
    def __get__(self, obj: object, owner: Any) -> Any: ...
    def __set__(self, obj: object, value: int) -> None: ...
    def __delete__(self, obj: object) -> None: ...


class MetaclassA(type):
    @property
    def attr1(cls) -> int:
        return 1

    @property
    def attr3(cls) -> int:
        return 3

    attr4 = "4"

    @property
    def attr5(cls) -> int:
        return 5

    attr6 = 6

    def __getattr__(self, name: str) -> complex: ...


class ClassA(metaclass=MetaclassA):
    @property
    def attr2(self) -> int:
        return 2

    @property
    def attr3(self) -> int:
        return 3

    @property
    def attr4(self) -> int:
        return 4

    attr5 = "5"


reveal_type(ClassA.attr1, expected_text="int")
reveal_type(ClassA().attr2, expected_text="int")
reveal_type(ClassA.attr2, expected_text="property")
reveal_type(ClassA().attr3, expected_text="int")
reveal_type(ClassA.attr3, expected_text="int")
reveal_type(ClassA.attr4, expected_text="property")
reveal_type(ClassA.attr5, expected_text="int")
reveal_type(ClassA.attr6, expected_text="int")
reveal_type(ClassA.attr7, expected_text="complex")


class ClassB:
    __mro__ = ""


reveal_type(ClassB.__mro__, expected_text="tuple[type, ...]")
reveal_type(ClassB().__mro__, expected_text="str")
reveal_type(type.__mro__, expected_text="tuple[type, ...]")


def func1():
    ClassB.__name__ = ""


def func2():
    # This should generate an error.
    ClassB.__mro__ = (ClassB, object)

    # This should generate an error.
    del ClassB.__mro__


class MetaclassC(type):
    get = Get()
    getset = GetSet()
    getdelete = GetDelete()
    getsetdelete = GetSetDelete()


class ClassC1(metaclass=MetaclassC):
    get = ""
    getset = ""
    getdelete = ""
    getsetdelete = ""


class ClassC2(metaclass=MetaclassC):
    pass


reveal_type(ClassC1.get, expected_text="str")
reveal_type(ClassC1.getset, expected_text="int")
reveal_type(ClassC1.getdelete, expected_text="int")
reveal_type(ClassC1.getsetdelete, expected_text="int")


def func3():
    ClassC1.getset = 1
    ClassC1.getsetdelete = 1


def func4():
    ClassC1.get = ""
    del ClassC1.get


def func5():
    # This should generate an error.
    ClassC1.getset = ""

    # This should generate an error.
    ClassC1.getsetdelete = ""


def func6():
    # This should generate an error.
    ClassC1.getdelete = 1


def func7():
    del ClassC1.getdelete
    del ClassC1.getsetdelete


def func8():
    # This should generate an error.
    del ClassC1.getset


def func9():
    del ClassC2.getdelete


def func10():
    # This should generate an error.
    del ClassC2.getset


def func11():
    # This should generate an error.
    ClassC2.getdelete = 1


class MetaclassD(type):
    attr1: ClassVar[GetSet | bytes]
    attr2: ClassVar[GetDelete | Get]


class ClassD(metaclass=MetaclassD):
    attr1 = ""
    attr2 = ""


reveal_type(ClassD.attr1, expected_text="str | int")


def func12():
    # This should generate an error.
    ClassD.attr1 = ""


def func13():
    # This should generate an error.
    del ClassD.attr1


def func14():
    # This should generate an error.
    ClassD.attr2 = ""
