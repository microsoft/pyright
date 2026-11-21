# This sample tests that the synthesized NamedTuple _replace method
# doesn't affect the inferred variance of a type parameter.


from typing import NamedTuple


class NT1[T](NamedTuple):
    value: T


def func1(nt: NT1[int]) -> NT1[object]:
    return nt
