from _typeshed import Incomplete, Self
from collections.abc import Callable
from typing import ClassVar

__all__ = ["TqdmCallback"]

# dask.callbacks.Callback
class _Callback:
    active: ClassVar[set[tuple[Callable[..., Incomplete] | None, ...]]]
    def __init__(
        self,
        start: Incomplete | None,
        start_state: Incomplete | None,
        pretask: Incomplete | None,
        posttask: Incomplete | None,
        finish: Incomplete | None,
    ) -> None: ...
    def __enter__(self: Self) -> Self: ...
    def __exit__(self, *args) -> None: ...
    def register(self) -> None: ...
    def unregister(self) -> None: ...

class TqdmCallback(_Callback):
    tqdm_class: type[Incomplete]
    def __init__(
        self, start: Incomplete | None = ..., pretask: Incomplete | None = ..., tqdm_class: type[Incomplete] = ..., **tqdm_kwargs
    ) -> None: ...
    def display(self) -> None: ...
