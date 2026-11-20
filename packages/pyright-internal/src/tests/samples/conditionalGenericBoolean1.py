from typing import Any, Generic, Literal, Never, TypeVar


T = TypeVar("T")
B = TypeVar("B", bound=bool)
L = TypeVar("L", Literal[True], Literal[False])
M = TypeVar("M", Literal[True], int)


class Flag(Generic[T]):
    def __init__(self, value: T) -> None:
        self.value = value

    def __bool__(self) -> T:
        return self.value


def valid(bound: Flag[B], literals: Flag[L], union: Flag[B | bool], gradual: Flag[Any]) -> None:
    first = bound or bound
    reveal_type(first, expected_text="Flag[B@valid]")
    second = literals and literals
    reveal_type(second, expected_text="Flag[L@valid]")
    if bound or literals:
        pass
    if union:
        pass
    if gradual:
        pass


def invalid(mixed: Flag[M], unconstrained: Flag[T], union: Flag[B | int], concrete: Flag[int], bottom: Flag[Never]):
    value = mixed or mixed
    if mixed:
        pass
    if unconstrained:
        pass
    if union:
        pass
    if concrete:
        pass
    if bottom:
        pass
    return value


def gradual_unions(safe: Flag[Any | bool], unsafe: Flag[Any | int]) -> None:
    result = safe or safe
    reveal_type(result, expected_text="Flag[Any | bool]")
    _ = unsafe or unsafe
