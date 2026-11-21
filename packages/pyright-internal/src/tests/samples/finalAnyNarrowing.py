# This sample validates runtime narrowing for final classes based on typing.Any.

# pyright: reportUnreachable=true

from types import NotImplementedType
from typing import Any, final


@final
class FinalAny(Any):
    pass


@final
class ExplicitObject(Any, object):
    pass


def check_class(value: int | FinalAny):
    if isinstance(value, int):
        reveal_type(value, expected_text="int")
    else:
        reveal_type(value, expected_text="FinalAny")

    match value:
        case int():
            reveal_type(value, expected_text="int")
        case _:
            reveal_type(value, expected_text="FinalAny")


def check_filter(value: int | ExplicitObject):
    if isinstance(value, ExplicitObject):
        reveal_type(value, expected_text="ExplicitObject")
    else:
        reveal_type(value, expected_text="int")

    match value:
        case ExplicitObject():
            reveal_type(value, expected_text="ExplicitObject")
        case _:
            reveal_type(value, expected_text="int")


def check_classes(cls: type[int] | type[FinalAny]):
    if issubclass(cls, int):
        reveal_type(cls, expected_text="type[int]")
    else:
        reveal_type(cls, expected_text="type[FinalAny]")


class AlwaysMatchesInstance(type):
    def __instancecheck__(self, instance: object) -> bool:
        return True


class InstanceTarget(metaclass=AlwaysMatchesInstance):
    pass


def check_instance_hook(value: FinalAny):
    if isinstance(value, InstanceTarget):
        reveal_type(value, expected_text="FinalAny")


class AlwaysMatchesSubclass(type):
    def __subclasscheck__(self, sub: type) -> bool:
        return True


class SubclassTarget(metaclass=AlwaysMatchesSubclass):
    pass


def check_subclass_hook(cls: type[NotImplementedType]) -> int:
    if issubclass(cls, SubclassTarget):
        # This should generate an error because the custom hook makes this branch reachable.
        return "reachable"
    return 0


class Base:
    pass


@final
class HasOtherBase(Any, Base):
    pass


def check_other_base(value: HasOtherBase):
    if isinstance(value, Base):
        reveal_type(value, expected_text="HasOtherBase")


def runtime_base() -> Any:
    return int


@final
class DynamicBase(runtime_base()):
    pass


def check_dynamic_base(value: DynamicBase):
    if isinstance(value, int):
        reveal_type(value, expected_text="DynamicBase")
