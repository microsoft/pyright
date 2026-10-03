# This sample tests None-valued __bool__ attributes in conditional expressions.

from typing import Any, TypeVar


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


T = TypeVar("T", bound=BoolIsNone)


def invalid_conditionals(
    value: BoolIsNone, inherited: InheritsBoolIsNone, sized: BoolIsNoneWithLen, inferred: InferredBoolIsNone
):
    # Each conditional operation below should generate an error.
    if value:
        pass
    assert value
    while value:
        break
    _negated = not value
    _choice = 1 if value else 2
    _filtered = [1 for _ in range(1) if value]
    if inherited:
        pass
    if sized:
        pass
    if inferred:
        pass
    match 1:
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
