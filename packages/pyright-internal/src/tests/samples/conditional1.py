# This sample tests that the check that validates the operand type for
# a conditional statement. The operand must be of type bool or a type
# that has a __bool__ method that returns a bool.

from dataclasses import dataclass, field
from typing import NoReturn, TypeVar


class ReturnsBool:
    def __bool__(self) -> bool:
        return True


class ReturnsNonBool:
    def __bool__(self) -> NoReturn:
        raise TypeError("Not a bool")


class BoolIsNone:
    __bool__: None = None


def func1(val: ReturnsNonBool):
    # This should generate an error.
    if val:
        pass

    # This should generate an error.
    a = not val

    b = val or 1
    # This should generate an error.
    if b:
        pass

    c = 1 and val
    # This should generate an error.
    if c:
        pass

    # This should generate an error.
    y = 1 if val else 2

    # This should generate an error.
    while val:
        break

    # This should generate an error.
    z = [1 for i in range(10) if val]


TVal = TypeVar("TVal", bound=ReturnsNonBool)


def func2(val: TVal | ReturnsBool) -> TVal | ReturnsBool:
    # This should generate an error.
    if val:
        pass

    # This should generate an error.
    a = not val

    b = val or 1
    # This should generate an error.
    if b:
        pass

    c = 1 and val
    # This should generate an error.
    if c:
        pass

    # This should generate an error.
    y = 1 if val else 2

    # This should generate an error.
    while val:
        break

    # This should generate an error.
    z = [1 for i in range(10) if val]

    return val


class Meta(type):
    def __bool__(self) -> int:
        return 1


class MetaDerived(metaclass=Meta):
    pass


def func3(val: type[MetaDerived]):
    # This should generate an error.
    if val:
        pass


def func4(val: BoolIsNone):
    # This should generate an error.
    if val:
        pass


class AnnotationOnly:
    __bool__: None


class InstanceOnly:
    __bool__: None

    def __init__(self) -> None:
        self.__bool__ = None


@dataclass
class DataClassField:
    __bool__: None = field(default_factory=lambda: None)


def func5(annotation_only: AnnotationOnly, instance_only: InstanceOnly, dataclass_field: DataClassField):
    if annotation_only:
        pass
    if instance_only:
        pass
    if dataclass_field:
        pass
