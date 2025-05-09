# This sample exercises the type analyzer's isinstance type narrowing logic.

from types import NoneType
from typing import (
    Any,
    Generic,
    Iterable,
    Iterator,
    Protocol,
    Sized,
    TypeVar,
    Union,
    runtime_checkable,
)

S = TypeVar("S")
T = TypeVar("T")


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


def f(instance: Union[SuperClass, UnrelatedClass], a: Any) -> None:
    if isinstance(instance, (MyClass1, UnrelatedSubclass, a)):
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


def g(cls: Union[type[SuperClass], type[UnrelatedClass]], a: Any) -> None:
    if issubclass(cls, (MyClass1, UnrelatedSubclass, a)):
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


def func5(ty: type[T]) -> type[T]:
    assert isinstance(ty, (type, str))
    return ty


def func6(ty: type[T]) -> type[T]:
    assert not isinstance(ty, str)
    return ty


def func6_2(ty: type[int] | int):
    if isinstance(ty, type):
        reveal_type(ty, expected_text="type[int]")
    else:
        reveal_type(ty, expected_text="int")


def func6_3(ty: type):
    if issubclass(ty, str):
        reveal_type(ty, expected_text="type[str]")
    else:
        reveal_type(ty, expected_text="type[Unknown]")


def func6_4(ty: Any):
    if issubclass(ty, str):
        reveal_type(ty, expected_text="type[str]")
    else:
        reveal_type(ty, expected_text="Any")


# Test the handling of protocol classes that support runtime checking.
def func7(a: Union[list[int], int]):
    if isinstance(a, Sized):
        reveal_type(a, expected_text="list[int]")
    else:
        reveal_type(a, expected_text="int")


# Test handling of member access expressions whose types change based
# on isinstance checks.


class Base1: ...


class Sub1_1(Base1):
    value: str


class Sub1_2(Base1):
    value: Base1


def handler(node: Base1) -> Any:
    if isinstance(node, Sub1_1):
        reveal_type(node.value, expected_text="str")
    elif isinstance(node, Sub1_2):
        reveal_type(node.value, expected_text="Base1")
        if isinstance(node.value, Sub1_1):
            reveal_type(node.value, expected_text="Sub1_1")


def func8a(a: int | list[int] | dict[str, int] | None):
    if isinstance(a, (str, (int, list, type(None)))):
        reveal_type(a, expected_text="int | list[int] | None")
    else:
        reveal_type(a, expected_text="dict[str, int]")


def func8b(a: int | list[int] | dict[str, int] | None):
    if isinstance(a, str | int | list | type(None)):
        reveal_type(a, expected_text="int | list[int] | None")
    else:
        reveal_type(a, expected_text="dict[str, int]")


TA1 = str | int | list | None


def func8c(a: int | list[int] | dict[str, int] | None):
    if isinstance(a, TA1):
        reveal_type(a, expected_text="int | list[int] | None")
    else:
        reveal_type(a, expected_text="dict[str, int]")


def func9(a: int | None):
    if not isinstance(a, NoneType):
        reveal_type(a, expected_text="int")
    else:
        reveal_type(a, expected_text="None")


class Base2(Generic[S, T]):
    pass


class Sub2(Base2[T, T]):
    pass


def func10(val: Sub2[str] | Base2[str, float]):
    if isinstance(val, Sub2):
        reveal_type(val, expected_text="Sub2[str] | Sub2[str | float]")


@runtime_checkable
class Proto1(Protocol):
    def f0(self, /) -> None: ...


@runtime_checkable
class Proto2(Proto1, Protocol):
    def f1(self, /) -> None: ...


def func11(x: Proto1):
    if isinstance(x, Proto2):
        reveal_type(x, expected_text="Proto2")
    else:
        reveal_type(x, expected_text="Proto1")


TA2 = list["TA3"] | dict[str, "TA3"]
TA3 = str | TA2


def func12(x: TA3) -> None:
    if isinstance(x, dict):
        reveal_type(x, expected_text="dict[str, str | list[TA3] | dict[str, TA3]]")
    else:
        reveal_type(x, expected_text="str | list[str | list[TA3] | dict[str, TA3]]")


def func13(x: object | type[object]) -> None:
    if isinstance(x, object):
        reveal_type(x, expected_text="object | type[object]")


def func14(x: Iterable[T]):
    if isinstance(x, Iterator):
        reveal_type(x, expected_text="Iterator[T@func14]")


class Base15(Generic[T]):
    value: T


class Child15(Base15[int]):
    value: int


def func15(x: Base15[T]):
    if isinstance(x, Child15):
        # This should generate an error. It's here just to ensure that
        # this code branch isn't marked unreachable.
        reveal_type(x, expected_text="Never")

        reveal_type(x, expected_text="Child15")
        reveal_type(x.value, expected_text="int")


def func16(x: Any):
    if isinstance(x, (int, int)):
        reveal_type(x, expected_text="int")


def func17(x: Any):
    if isinstance(x, (Union[int, int])):
        reveal_type(x, expected_text="int")
