# This sample tests the case where a constructor call is evaluated
# using bidirectional type inference in the case where the expected
# type is `Self`.

# pyright: strict

from __future__ import annotations

from typing import Any, Generic, Protocol, TypeVar
from typing_extensions import Self  # pyright: ignore[reportMissingModuleSource]

T_contra = TypeVar("T_contra", contravariant=True)
ThingT = TypeVar("ThingT", bound="Thing[Any]")


class Callback(Protocol[T_contra]):
    def __call__(self, message: T_contra, /) -> Any: ...


class Thing(Generic[T_contra]):
    def __init__(self, callback: Callback[T_contra]) -> None:
        self._callback: Callback[T_contra] = callback

    def copy(self) -> Self:
        return type(self)(self._callback)
