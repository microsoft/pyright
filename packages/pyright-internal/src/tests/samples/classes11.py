# This sample tests the detection of mutually-incompatible base classes
# in classes that use multiple inheritance.

from typing import Collection, Mapping, Sequence, TypeVar


# This should generate an error.
class A(Mapping[str, int], Collection[int]):
    ...


# This should generate an error.
class B(Mapping[str, int], Sequence[int]):
    ...


# This should generate an error.
class C(Sequence[int], Mapping[str, int]):
    ...


class D(Sequence[float], Mapping[float, int]):
    ...


class E(Sequence[float], Mapping[int, int]):
    ...


# This should generate an error.
class F(Mapping[int, int], Sequence[float]):
    ...


T = TypeVar("T")
S = TypeVar("S")


class G(Mapping[T, S], Collection[T]):
    ...


# This should generate an error.
class H(Mapping[T, S], Collection[S]):
    ...
