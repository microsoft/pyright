# This sample tests the case where a metaclass defines a descriptor
# protocol (i.e. a `__get__` method), and a member is accessed through
# the class.

from typing import Any


class _IntDescriptorMeta(type):
    def __get__(self, instance: Any, owner: Any) -> int:
        return 123

    def __set__(self, instance: Any, value: str) -> None:
        pass


class IntDescriptorClass(metaclass=_IntDescriptorMeta): ...


class X:
    number_cls = IntDescriptorClass


reveal_type(X.number_cls, expected_text="int")
reveal_type(X().number_cls, expected_text="int")

X.number_cls = "hi"

X().number_cls = "hi"

# This should generate an error
X.number_cls = 1

# This should generate an error
X().number_cls = 1


class FlagValue:
    def __init__(self, func):
        self.value: bool = bool(func(None))

    def __set__(self, instance: "Flags", value: int):
        self.value = bool(value)


class Flags:
    @FlagValue
    def suppress(self):
        return 2


flags = Flags()


def func1(new: Any):
    flags.suppress = new


def func2(new: int):
    flags.suppress = new


def func3(new: bool):
    flags.suppress = new
