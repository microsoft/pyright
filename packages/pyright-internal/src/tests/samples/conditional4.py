# This sample tests bool assignability after calling a bound __bool__ member.

from typing import Any, Callable, Generic, Literal, Never, Self, TypeVar


TBool = TypeVar("TBool", bound=bool)
TConstrainedBool = TypeVar("TConstrainedBool", Literal[True], Literal[False])


class GenericBool(Generic[TBool]):
    def __init__(self, value: TBool):
        self.value = value

    def __bool__(self) -> TBool:
        return self.value


class GenericBoolProperty(Generic[TBool]):
    def __init__(self, value: TBool):
        self.value = value

    @property
    def __bool__(self) -> Callable[[], TBool]:
        return lambda: self.value


class GradualBool:
    def __bool__(self) -> bool | Any:
        return True


class GradualBoolProperty:
    @property
    def __bool__(self) -> Callable[[], bool | Any]:
        return lambda: True


class IntUnion:
    def __bool__(self) -> bool | int:
        return 1


class GradualIntUnion:
    def __bool__(self) -> int | Any:
        return 1


class NeverBool:
    def __bool__(self) -> Never:
        raise TypeError("No truth value")


class NeverBoolProperty:
    @property
    def __bool__(self) -> Callable[[], Never]:
        def fail() -> Never:
            raise TypeError("No truth value")

        return fail


class SelfBool:
    def __bool__(self) -> Self:
        return self


def valid_conditionals(
    generic: GenericBool[TBool],
    generic_property: GenericBoolProperty[TBool],
    gradual: GradualBool,
    gradual_property: GradualBoolProperty,
    none: None,
    none_class: type[None],
    function: Callable[[], int],
):
    if generic:
        pass
    if generic_property:
        pass
    if gradual:
        pass
    if gradual_property:
        pass
    if none:
        pass
    if none_class:
        pass
    if function:
        pass


def valid_constrained(value: GenericBool[TConstrainedBool]) -> TConstrainedBool:
    if value:
        pass
    return value.value


def invalid_conditionals(
    integer: IntUnion,
    gradual_integer: GradualIntUnion,
    never: NeverBool,
    never_property: NeverBoolProperty,
    self_result: SelfBool,
):
    # This should generate an error because int is not assignable to bool.
    if integer:
        pass
    # This should generate an error even though the return union contains Any.
    if gradual_integer:
        pass
    # This should generate an error, preserving the existing Never-return policy.
    if never:
        pass
    # This should generate an error, preserving the existing Never-return policy.
    if never_property:
        pass
    # This should generate an error because the containing class is not bool.
    if self_result:
        pass
