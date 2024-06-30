# This sample tests the handling of generic protocols or protocols
# with generic methods.

from typing import Protocol, Sequence, TypeVar

A = TypeVar("A")


class HasAdd1(Protocol[A]):
    def __add__(self: A, other: A) -> A: ...


T1 = TypeVar("T1", bound=HasAdd1)


def merge_element_lists1(a: Sequence[T1], b: Sequence[T1]) -> Sequence[T1]:
    retval: Sequence[T1] = []
    for a_elem in a:
        for b_elem in b:
            retval.append(a_elem + b_elem)
    return retval


# This is similar to HasAdd1 except that the class isn't generic.
class HasAdd2(Protocol):
    def __add__(self: A, other: A) -> A: ...


T2 = TypeVar("T2", bound=HasAdd2)


def merge_element_lists2(a: Sequence[T2], b: Sequence[T2]) -> Sequence[T2]:
    retval: Sequence[T2] = []
    for a_elem in a:
        for b_elem in b:
            retval.append(a_elem + b_elem)
    return retval
