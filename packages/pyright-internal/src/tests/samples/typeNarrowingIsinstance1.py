# This sample exercises the type analyzer's isinstance type narrowing logic.

from types import NoneType
from typing import Sized, TypeVar, Union, Any


class UnrelatedClass:
    class_var1: int

    def __init__(self) -> None:
        self.property: None = None


class UnrelatedSubclass(UnrelatedClass):
    def __init__(self) -> None:
        self.property2: None = None


class SuperClass:
    class_var1: int

    def __init__(self) -> None:
        self.property: None = None


class MyClass1(SuperClass):
    class_var2: int

    def __init__(self) -> None:
        self.property2: None = None


class MyClass2(SuperClass):
    def __init__(self) -> None:
        self.property2: None = None


def f(instance: Union[SuperClass, UnrelatedClass]) -> None:
    if isinstance(instance, (MyClass1, UnrelatedSubclass, Any)):
        print(instance.property)

        # This should generate two errors:
        # 'property2' is not a known member of 'SuperClass'
        # 'property2' is not a known member of 'UnrelatedClass'
        print(instance.property2)
    else:
        print(instance.property)

        # This should generate two errors:
        # 'property2' is not a known member of 'SuperClass'
        # 'property2' is not a known member of 'UnrelatedClass'
        print(instance.property2)


def g(cls: Union[type[SuperClass], type[UnrelatedClass]]) -> None:
    if issubclass(cls, (MyClass1, UnrelatedSubclass, Any)):
        print(cls.class_var1)

        # This should generate two errors:
        # 'property2' is not a known member of 'SuperClass'
        # 'property2' is not a known member of 'UnrelatedClass'
        print(cls.class_var2)
    else:
        print(cls.class_var1)

        # This should generate two errors:
        # 'property2' is not a known member of 'SuperClass'
        # 'property2' is not a known member of 'UnrelatedClass'
        print(cls.class_var2)


# This code should analyze without any errors.
class TestClass1:
    def __init__(self) -> None:
        self.property = True


class TestClass2(TestClass1):
    pass


def func1(instance: TestClass2) -> None:
    # Although it's redundant for code to check for either
    # TestClass1 or TestClass2, the analyzer should be fine with it.
    if isinstance(instance, TestClass2):
        print(instance.property)

    if isinstance(instance, TestClass1):
        print(instance.property)


def func2(val: Union[int, None, str]) -> int | None:
    return None if isinstance((z := val), str) else z


# Test the special-case handling of isinstance with a
# "type" class.
def func3(ty: type[int]) -> type[int]:
    assert isinstance(ty, (type, str))
    return ty


def func4(ty: type[int]) -> type[int]:
    assert not isinstance(ty, str)
    return ty


T = TypeVar("T")


def func5(ty: type[T]) -> type[T]:
    assert isinstance(ty, (type, str))
    return ty


def func6(ty: type[T]) -> type[T]:
    assert not isinstance(ty, str)
    return ty


# Test the handling of protocol classes that support runtime checking.
def func7(a: Union[list[int], int]):
    if isinstance(a, Sized):
        reveal_type(a, expected_text="list[int]")
    else:
        reveal_type(a, expected_text="int")


# Test handling of member access expressions whose types change based
# on isinstance checks.


class Base1:
    ...


class Sub1(Base1):
    value: str


class Sub2(Base1):
    value: Base1


def handler(node: Base1) -> Any:
    if isinstance(node, Sub1):
        reveal_type(node.value, expected_text="str")
    elif isinstance(node, Sub2):
        reveal_type(node.value, expected_text="Base1")
        if isinstance(node.value, Sub1):
            reveal_type(node.value, expected_text="Sub1")


def func8(a: int | list[int] | dict[str, int] | None):
    if isinstance(
        a,
        (str, (int, list, type(None))),
    ):
        reveal_type(a, expected_text="int | list[int] | None")
    else:
        reveal_type(a, expected_text="dict[str, int]")


def func9(a: int | None):
    if not isinstance(a, NoneType):
        reveal_type(a, expected_text="int")
    else:
        reveal_type(a, expected_text="None")
