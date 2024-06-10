# This sample tests the handling of NamedTuple classes with generics,
# which is supported in Python 3.11 and newer.

from typing import Generic, NamedTuple, TypeVar


_T1 = TypeVar("_T1")


class NT1(NamedTuple, Generic[_T1]):
    a: _T1
    b: int
    c: list[_T1]


reveal_type(NT1(3, 4, []), expected_text="NT1[int]")
reveal_type(NT1(3.4, 4, [1, 2]), expected_text="NT1[float]")
reveal_type(NT1(3.4, 4, [2j]), expected_text="NT1[complex]")


class NT2(NT1[str]): ...


reveal_type(NT2("", 4, []), expected_text="NT2")

# This should generate an error.
NT2(1, 4, [])
