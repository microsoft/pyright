# This sample tests the handling of type[T] and Type[T].

from typing import Any, Type


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
