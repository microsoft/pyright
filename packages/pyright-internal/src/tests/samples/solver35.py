# This sample tests the case where the constraint solver is asked to
# solve a TypeVar that is in an invariant context.

from typing import TypeVar

T1 = TypeVar("T1")
T2 = TypeVar("T2")


def func1(v1: T1, v2: T2, v1_list: list[T1], v2_list: list[T2]): ...


def func2(v1: int, v2: str, v1_list: list[int], v2_list: list[str]):
    func1(v1, v2, v1_list, v2_list)

    # This should generate an error because the last two arguments are swapped.
    func1(v2, v1, v1_list, v2_list)

    # This should generate an error because the last two arguments are swapped.
    func1(v1_list=v1_list, v2_list=v2_list, v1=v2, v2=v1)
