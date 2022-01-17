# This sample tests isinstance type narrowing when the class list
# includes "Callable".

from typing import Callable, List, Sequence, TypeVar, Union


class A:
    ...


class B:
    def __call__(self, x: str) -> int:
        ...


class C:
    ...


class D(C):
    ...


TCall1 = TypeVar("TCall1", bound=Callable[..., int])


def func1(obj: Union[Callable[[int, str], int], List[int], A, B, C, D, TCall1]):
    if isinstance(obj, (Callable, Sequence, C)):
        reveal_type(
            obj,
            expected_text="((int, str) -> int) | List[int] | B | C | D | TCall1@func1",
        )
    else:
        reveal_type(obj, expected_text="A")

    if isinstance(obj, Callable):
        reveal_type(obj, expected_text="((int, str) -> int) | B | TCall1@func1")
    else:
        reveal_type(obj, expected_text="List[int] | C | D | A")
