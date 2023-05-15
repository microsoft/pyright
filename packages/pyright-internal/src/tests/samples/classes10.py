# This sample tests the handling of dynamic base classes.

from typing import TypeVar

T_A = TypeVar("T_A", bound="A")


class A:
    class InnerA:
        pass


def dynamic_subclass(cls: type[T_A]):
    class SubClass(cls):
        class SubInnerClass(cls.InnerA):
            pass

    return SubClass
