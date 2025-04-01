# This sample tests bidirectional inference when the type derives from the
# expected type and both are generic.

from typing import Generic, Iterable, Mapping, TypeVar

v0: Mapping[str, int | str] | None = dict([("test1", 1), ("test2", 2)])

v1: Mapping[str, float] | None = dict([("test1", 1), ("test2", 2)])

# This should generate an error because of a type mismatch.
v2: Mapping[str, str] = dict([("test1", 1), ("test2", "2")])


options: dict[int | str, int] = {}
channel_types: dict[str, int] = {}

keys = channel_types.keys()

options.update(dict.fromkeys(keys, 1))


_KT = TypeVar("_KT")
_VT = TypeVar("_VT")
_S = TypeVar("_S")
_T = TypeVar("_T")
_X = TypeVar("_X")


class A(Generic[_KT, _VT]):
    @classmethod
    def method1(cls, i: Iterable[_T], v: _S) -> "A[_T, _S]": ...


def func1(__x: A[int, _X] | A[str, _X] | A[str | int, _X]) -> A[int, _X]: ...


v3 = func1(A.method1("a", "b"))
reveal_type(v3, expected_text="A[int, str]")

v4 = str.maketrans(dict.fromkeys("a", "b"))
reveal_type(v4, expected_text="dict[int, str]")
