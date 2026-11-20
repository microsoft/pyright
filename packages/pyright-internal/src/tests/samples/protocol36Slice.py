from collections.abc import Iterator
from typing import Any, Literal, Protocol, TypeVar, overload


T_co = TypeVar("T_co", covariant=True)


class SliceSequence(Protocol[T_co]):
    def __len__(self, /) -> int: ...
    def __getitem__(self, index: slice, /) -> T_co | "SliceSequence[T_co]": ...
    def __iter__(self, /) -> Iterator[Any]: ...


@overload
def choose(value: SliceSequence[str]) -> Literal["slice"]: ...
@overload
def choose(value: object) -> str: ...
def choose(value: object) -> str:
    return "slice"


def check(values: list[int]) -> None:
    compatible: SliceSequence[str] = values
    reveal_type(choose(values), expected_text="Literal['slice']")