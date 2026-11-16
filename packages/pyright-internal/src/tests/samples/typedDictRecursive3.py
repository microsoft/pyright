# This sample tests inference through captured inline TypedDict type variables
# when a failed union alternative has already compared the same dictionary pair.

from typing import Any, Protocol, ReadOnly, TypedDict


class P[T, U](Protocol):
    type A = TypedDict[{"v": ReadOnly[T]}]

    @property
    def data(self) -> TypedDict[
        {"v": ReadOnly[tuple[A, int, U] | tuple[A, str, U]]}
    ]: ...


type B = TypedDict[{"v": ReadOnly[int]}]


class S:
    A: Any

    @property
    def data(self) -> TypedDict[{"v": ReadOnly[tuple[B, str, bool]]}]:
        raise NotImplementedError


def f[T, U](p: P[T, U]) -> tuple[T, U]:
    raise NotImplementedError


def g(s: S):
    reveal_type(f(s), expected_text="tuple[int, bool]")
