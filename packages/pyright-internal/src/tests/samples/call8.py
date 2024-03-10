# This sample tests a case where multiple overloaded calls are nested
# within each other.

from typing import Any, Iterable, TypeVar, Protocol, overload
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    LiteralString,
)

_T = TypeVar("_T")
_T_co = TypeVar("_T_co", covariant=True)


class SupportsLenAndGetItem(Protocol[_T_co]):
    def __getitem__(self, __k: int) -> _T_co: ...


def choices(population: SupportsLenAndGetItem[_T]) -> list[_T]: ...


@overload
def join(__iterable: Iterable[LiteralString]) -> LiteralString:  # type:ignore
    ...


@overload
def join(__iterable: Iterable[str]) -> str: ...


@overload
def array(object: int) -> list[Any]: ...


@overload
def array(object: object) -> list[Any]: ...


def array(object: object) -> list[Any]: ...


array([join(choices("")) for i in range(1)])
