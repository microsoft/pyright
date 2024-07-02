# This sample tests isinstance type narrowing when the class list
# includes "Callable".

from typing import Callable, Sequence, TypeVar


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
            expected_text="((int, str) -> int) | list[int] | B | C | D | TCall1@func1",
        )
    else:
        reveal_type(obj, expected_text="A")

    if isinstance(obj, Callable):
        reveal_type(obj, expected_text="((int, str) -> int) | B | TCall1@func1")
    else:
        reveal_type(obj, expected_text="list[int] | C | D | A")
