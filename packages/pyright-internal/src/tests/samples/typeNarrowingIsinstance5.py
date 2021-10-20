# This sample tests isinstance type narrowing when the class list
# includes "Callable".

from typing import Callable, List, Literal, Sequence, TypeVar, Union


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
        t1: Literal[
            "(int, str) -> int | List[int] | B | C | D | TCall1@func1"
        ] = reveal_type(obj)
    else:
        t2: Literal["A"] = reveal_type(obj)

    if isinstance(obj, Callable):
        t3: Literal["(int, str) -> int | B | TCall1@func1"] = reveal_type(obj)
    else:
        t4: Literal["List[int] | C | D | A"] = reveal_type(obj)
