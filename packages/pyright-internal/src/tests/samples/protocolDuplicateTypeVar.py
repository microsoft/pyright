# This sample tests duplicate type variables in Protocol.

from typing import Protocol, TypeVar

T = TypeVar("T", covariant=True)
S = TypeVar("S", covariant=True)


# This should generate an error because Protocol type arguments must be unique.
class Duplicate(Protocol[T, T]): ...


# This should not generate an error because the type arguments are unique.
class Distinct(Protocol[T, S]): ...


# This should generate an error because Protocol type arguments must be type parameters.
class Invalid(Protocol[int, T]): ...
