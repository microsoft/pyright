# This sample tests isinstance type narrowing when the class list
# includes "Callable".

from typing import Callable, Sequence, TypeVar, final


class A: ...


class B:
    def __call__(self, x: str) -> int: ...


class C: ...


class D(C): ...


TCall1 = TypeVar("TCall1", bound=Callable[..., int])


def func1(
    obj: Callable[[int, str], int] | list[int] | A | B | C | D | TCall1,
) -> TCall1 | None:
    if isinstance(obj, (Callable, Sequence, C)):
        reveal_type(
            obj,
            expected_text="((int, str) -> int) | Sequence[Unknown] | C | list[int] | B | D | TCall1@func1",
        )
    else:
        reveal_type(obj, expected_text="A")

    if isinstance(obj, Callable):
        reveal_type(obj, expected_text="((int, str) -> int) | B | TCall1@func1")
    else:
        reveal_type(obj, expected_text="Sequence[Unknown] | C | list[int] | D | A")


class CB1:
    def __call__(self, x: str) -> None: ...


def func2(c1: Callable[[int], None], c2: Callable[..., None]):
    if isinstance(c1, CB1):
        reveal_type(c1, expected_text="Never")

    if isinstance(c2, CB1):
        reveal_type(c2, expected_text="CB1")


class IsNotFinal: ...


def func3(c1: Callable[[int], None]):
    if isinstance(c1, IsNotFinal):
        reveal_type(c1, expected_text="IsNotFinal")


@final
class IsFinal: ...


def func4(c1: Callable[[int], None]):
    if isinstance(c1, IsFinal):
        reveal_type(c1, expected_text="Never")
