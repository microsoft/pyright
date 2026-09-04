from collections.abc import Callable, Iterator
from typing import Literal, Protocol, TypeVar, overload


T_co = TypeVar("T_co", covariant=True)


class SupportsArray(Protocol):
    def __array__(self) -> object: ...


class NestedSequence(Protocol[T_co]):
    def __len__(self, /) -> int: ...
    def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
    def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...


class ArrayImpl:
    def __array__(self) -> object:
        return object()


@overload
def choose(value: NestedSequence[SupportsArray]) -> Literal["array"]: ...
@overload
def choose(value: object) -> str: ...
def choose(value: object) -> str:
    return "array"


@overload
def operation(value: int) -> int: ...
@overload
def operation(value: str) -> str: ...
def operation(value: int | str) -> int | str:
    return value


def generic[T](values: list[T], nested: list[tuple[T, int]]) -> None:
    reveal_type(choose(values), expected_text="str")
    reveal_type(choose(nested), expected_text="str")


def callable_params[**Params, Result](value: Callable[Params, Result]) -> None:
    reveal_type(choose([value]), expected_text="str")
    reveal_type(choose([[value]]), expected_text="str")


def variadic[*Shape](values: list[tuple[*Shape]]) -> None:
    reveal_type(choose(values), expected_text="str")


def negative_first() -> None:
    reveal_type(choose([operation]), expected_text="str")
    reveal_type(choose([[operation]]), expected_text="str")
    reveal_type(choose([ArrayImpl()]), expected_text="Literal['array']")
    reveal_type(choose([[ArrayImpl()]]), expected_text="Literal['array']")


def positive_first() -> None:
    reveal_type(choose([ArrayImpl()]), expected_text="Literal['array']")
    reveal_type(choose([[ArrayImpl()]]), expected_text="Literal['array']")
    reveal_type(choose([operation]), expected_text="str")
    reveal_type(choose([[operation]]), expected_text="str")