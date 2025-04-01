# This sample tests a case of bidirectional type inference for calls
# that involves a union in the expected type.

# pyright: strict

from __future__ import annotations

from collections.abc import Callable
from typing import Generic, TypeVar

T_co = TypeVar("T_co", covariant=True)
E_co = TypeVar("E_co", covariant=True)
F = TypeVar("F")


class Ok(Generic[T_co]):
    def or_else(self, op: object) -> Ok[T_co]: ...


class Err(Generic[E_co]):
    def or_else(self, op: Callable[[E_co], Result[T_co, F]]) -> Result[T_co, F]: ...


Result = Ok[T_co] | Err[E_co]


def inner(func: Callable[[E_co], Err[F]], r: Result[T_co, E_co]) -> Result[T_co, F]:
    match r:
        case Ok():
            return r.or_else(func)
        case Err():
            return r.or_else(func)
