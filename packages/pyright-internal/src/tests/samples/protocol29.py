# This sample tests the special-case handling of properties that return
# generics within a protocol.

from functools import partial
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Protocol,
    Self,
)
from typing import Any, Callable, TypeVar

_T = TypeVar("_T", covariant=True)


class Partial(Protocol[_T]):
    @property
    def func(self) -> Callable[..., _T]: ...

    def __new__(
        cls: type[Self], __func: Callable[..., _T], *args: Any, **kwargs: Any
    ) -> Self: ...


def func1(x: Partial[int]): ...


func1(partial(int))
