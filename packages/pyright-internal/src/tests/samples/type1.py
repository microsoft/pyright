# This sample tests the handling of type[T] and Type[T].

from typing import Any, Callable, Generic, Type, TypeVar


def func1(t1: Type, t2: Type[Any], t3: type, t4: type[Any]):
    reveal_type(t1.x, expected_text="Unknown")
    reveal_type(t2.x, expected_text="Any")
    reveal_type(t3.x, expected_text="Unknown")
    reveal_type(t4.x, expected_text="Any")

    reveal_type(t1.__name__, expected_text="str")
    reveal_type(t2.__name__, expected_text="str")
    reveal_type(t3.__name__, expected_text="str")
    reveal_type(t4.__name__, expected_text="str")

    reveal_type(t1.__sizeof__, expected_text="() -> int")
    reveal_type(t2.__sizeof__, expected_text="() -> int")
    reveal_type(t3.__sizeof__, expected_text="() -> int")
    reveal_type(t4.__sizeof__, expected_text="() -> int")


def func2(t1: Type[object], t2: type[object]):
    # This should generate an error.
    t1.x

    # This should generate an error.
    t2.x

    reveal_type(t1.__name__, expected_text="str")
    reveal_type(t2.__name__, expected_text="str")

    reveal_type(t1.__sizeof__, expected_text="(self: object) -> int")
    reveal_type(t2.__sizeof__, expected_text="(self: object) -> int")


TA1 = Type
reveal_type(TA1, expected_text="type[Type[Unknown]]")

# This should generate an error.
TA1.x

TA2 = Type[Any]
reveal_type(TA2, expected_text="type[Type[Any]]")

# This should generate an error.
TA2.x

TA3 = type
reveal_type(TA3, expected_text="type[type]")

# This should generate an error.
TA3.x

TA4 = type[Any]
reveal_type(TA4, expected_text="type[type[Any]]")

# This should generate an error.
TA4.x


def func3(t1: TA1, t2: TA2, t3: TA3, t4: TA4):
    reveal_type(t1.x, expected_text="Unknown")
    reveal_type(t2.x, expected_text="Any")
    reveal_type(t3.x, expected_text="Unknown")
    reveal_type(t4.x, expected_text="Any")

    reveal_type(t1.__name__, expected_text="str")
    reveal_type(t2.__name__, expected_text="str")
    reveal_type(t3.__name__, expected_text="str")
    reveal_type(t4.__name__, expected_text="str")

    reveal_type(t1.__sizeof__, expected_text="() -> int")
    reveal_type(t2.__sizeof__, expected_text="() -> int")
    reveal_type(t3.__sizeof__, expected_text="() -> int")
    reveal_type(t4.__sizeof__, expected_text="() -> int")


TA5 = Type[object]
TA6 = type[object]


def func4(t1: TA5, t2: TA6):
    # This should generate an error.
    t1.x

    # This should generate an error.
    t2.x

    reveal_type(t1.__name__, expected_text="str")
    reveal_type(t2.__name__, expected_text="str")

    reveal_type(t1.__sizeof__, expected_text="(self: object) -> int")
    reveal_type(t2.__sizeof__, expected_text="(self: object) -> int")


T = TypeVar("T")

TA7 = type[T]
TA8 = Type[T]


def func5(t1: TA7[T]) -> T:
    return t1()


def func6(t1: TA8[T]) -> T:
    return t1()


reveal_type(func5(int), expected_text="int")
reveal_type(func6(int), expected_text="int")


def func7(v: type):
    x1: Callable[..., Any] = v
    x2: Callable[[int, int], int] = v
    x3: object = v
    x4: type = v
    x5: type[int] = v
    x6: type[Any] = v


class Class1(Generic[T]):
    def method1(self, v: type) -> type[T]:
        return v


class Class2:
    x1: type
    x2: type[Any]


reveal_type(Class2.x1, expected_text="type")
reveal_type(Class2.x2, expected_text="type[Any]")
