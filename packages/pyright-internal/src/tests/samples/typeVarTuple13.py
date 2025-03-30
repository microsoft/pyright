# This sample tests the case where a variadic TypeVar is unpacked
# in a call expression that invokes a call that accepts an unpacked
# TypeVarTuple.

from typing import Protocol, TypeVar
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)


T = TypeVar("T")
Ts = TypeVarTuple("Ts")


class CallbackPosOnly(Protocol[Unpack[Ts]]):
    def __call__(self, *args: *Ts) -> tuple[Unpack[Ts]]: ...


def invoke_posonly(fn: CallbackPosOnly[Unpack[Ts]], *args: *Ts) -> tuple[Unpack[Ts]]:
    return fn(*args)


class CallbackKeyed(Protocol[Unpack[Ts]]):
    def __call__(self, *args: *Ts, keyed: bool) -> tuple[Unpack[Ts]]: ...


def invoke_keyed(fn: CallbackKeyed[Unpack[Ts]], *args: *Ts) -> tuple[Unpack[Ts]]:
    return fn(*args, keyed=True)


def invoke_keyed_should_fail(
    fn: CallbackKeyed[Unpack[Ts]], *args: *Ts
) -> tuple[Unpack[Ts]]:
    # This should generate an error because "keyed" should
    # be interpreted as a keyword-only parameter.
    return fn(*args, True)
