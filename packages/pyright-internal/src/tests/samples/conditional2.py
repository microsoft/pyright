# This sample tests non-callable __bool__ attributes in conditional expressions.

from typing import Any, Callable, Generic, Never, Protocol, TypeVar


class BoolIsNone:
    __bool__: None = None


class InheritsBoolIsNone(BoolIsNone):
    pass


class InferredBoolIsNone:
    __bool__ = None


class BoolIsNoneWithLen(BoolIsNone):
    def __len__(self) -> int:
        return 1


class ReturnsBool:
    def __bool__(self) -> bool:
        return True


class OnlyLen:
    def __len__(self) -> int:
        return 0


class DynamicBool:
    __bool__: Any


class InstanceBoolIsNone:
    def __init__(self):
        self.__bool__: None = None


class BoolIsInt:
    __bool__: int = 1


class BoolIsString:
    __bool__ = "disabled"


class BoolIsIntWithLen(BoolIsInt):
    def __len__(self) -> int:
        return 1


class BoolIsOptionalCallable:
    __bool__: Callable[[], bool] | None


class BoolIsCallableOrInt:
    __bool__: Callable[[], bool] | int


class BoolPropertyIsNone:
    @property
    def __bool__(self) -> None:
        return None


class NoneBoolMeta(type):
    __bool__ = None


class IntBoolMeta(type):
    __bool__: int = 1


class ClassWithNoneBool(metaclass=NoneBoolMeta):
    pass


class ClassWithIntBool(metaclass=IntBoolMeta):
    pass


class BadCallable:
    __call__ = None


class BoolIsBadCallable:
    __bool__ = BadCallable()


class NestedBadCallable:
    __call__ = BadCallable()


class BoolIsNestedBadCallable:
    __bool__ = NestedBadCallable()


class CallableUnion:
    __call__: Callable[[], bool] | Callable[[], int]


class BoolIsCallableUnion:
    __bool__ = CallableUnion()


class CallableBool:
    def __call__(self) -> bool:
        return True


class BoolIsCallableInstance:
    __bool__ = CallableBool()


class BoolIsCallableClass:
    __bool__ = bool


class BoolPropertyIsCallable:
    @property
    def __bool__(self) -> Callable[[], bool]:
        return lambda: True


class BoolIsNever:
    __bool__: Never


class BoolCallback(Protocol):
    def __call__(self) -> bool: ...


class BoolIsCallback:
    __bool__: BoolCallback


TCallable = TypeVar("TCallable", bound=Callable[[], bool])
TNonCallable = TypeVar("TNonCallable", bound=int)


class GenericCallableBool(Generic[TCallable]):
    __bool__: TCallable


class GenericNonCallableBool(Generic[TNonCallable]):
    __bool__: TNonCallable


T = TypeVar("T", bound=BoolIsNone)


def invalid_conditionals(
    value: BoolIsNone, inherited: InheritsBoolIsNone, sized: BoolIsNoneWithLen, inferred: InferredBoolIsNone
):
    # This should generate an error.
    if value:
        pass
    # This should generate an error.
    assert value
    # This should generate an error.
    while value:
        break
    # This should generate an error.
    _negated = not value
    # This should generate an error.
    _choice = 1 if value else 2
    # This should generate an error.
    _filtered = [1 for _ in range(1) if value]
    # This should generate an error.
    if inherited:
        pass
    # This should generate an error.
    if sized:
        pass
    # This should generate an error.
    if inferred:
        pass
    match 1:
        # This should generate an error.
        case _ if value:
            pass


def invalid_union(value: BoolIsNone | ReturnsBool):
    # This should generate an error for the invalid union member.
    if value:
        pass


def invalid_bound(value: T) -> T:
    # This should generate an error for the TypeVar bound.
    if value:
        pass
    return value


def invalid_non_callable_conditionals(
    integer: BoolIsInt,
    string: BoolIsString,
    sized: BoolIsIntWithLen,
    optional: BoolIsOptionalCallable,
    mixed: BoolIsCallableOrInt,
    descriptor: BoolPropertyIsNone,
    bad_callable: BoolIsBadCallable,
    nested_bad_callable: BoolIsNestedBadCallable,
    generic: GenericNonCallableBool[int],
    union: BoolIsCallableUnion,
):
    # This should generate an error.
    if integer:
        pass
    # This should generate an error.
    if string:
        pass
    # This should generate an error.
    if sized:
        pass
    # This should generate an error.
    if optional:
        pass
    # This should generate an error.
    if mixed:
        pass
    # This should generate an error.
    if descriptor:
        pass
    # This should generate an error.
    if bad_callable:
        pass
    # This should generate an error.
    if nested_bad_callable:
        pass
    # This should generate an error.
    if generic:
        pass
    # This should generate an error.
    if ClassWithNoneBool:
        pass
    # This should generate an error.
    if ClassWithIntBool:
        pass
    # This should generate an error because one callable returns int.
    if union:
        pass


def valid_conditionals(
    value: ReturnsBool, sized: OnlyLen, dynamic: DynamicBool, unknown: Any, instance_only: InstanceBoolIsNone
):
    if value:
        pass
    if sized:
        pass
    if dynamic:
        pass
    if unknown:
        pass
    if BoolIsNone:
        pass
    if object():
        pass
    if True:
        pass
    if instance_only:
        pass


def valid_callable_conditionals(
    instance: BoolIsCallableInstance,
    constructor: BoolIsCallableClass,
    descriptor: BoolPropertyIsCallable,
    never: BoolIsNever,
    callback: BoolIsCallback,
    generic: GenericCallableBool[Callable[[], bool]],
):
    if instance:
        pass
    if constructor:
        pass
    if descriptor:
        pass
    if never:
        pass
    if callback:
        pass
    if generic:
        pass
