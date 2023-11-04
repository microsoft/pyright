import sys
from collections.abc import Callable, Iterable, Iterator, Mapping
from types import TracebackType
from typing import Any, Generic, TypeVar
from typing_extensions import Literal, Self

if sys.version_info >= (3, 9):
    from types import GenericAlias

__all__ = ["Pool", "ThreadPool"]

_S = TypeVar("_S")
_T = TypeVar("_T")

class ApplyResult(Generic[_T]):
    if sys.version_info >= (3, 8):
        def __init__(
            self, pool: Pool, callback: Callable[[_T], object] | None, error_callback: Callable[[BaseException], object] | None
        ) -> None: ...
    else:
        def __init__(
            self,
            cache: dict[int, ApplyResult[Any]],
            callback: Callable[[_T], object] | None,
            error_callback: Callable[[BaseException], object] | None,
        ) -> None: ...

    def get(self, timeout: float | None = None) -> _T: ...
    def wait(self, timeout: float | None = None) -> None: ...
    def ready(self) -> bool: ...
    def successful(self) -> bool: ...
    if sys.version_info >= (3, 9):
        def __class_getitem__(cls, item: Any) -> GenericAlias: ...

# alias created during issue #17805
AsyncResult = ApplyResult

class MapResult(ApplyResult[list[_T]]):
    if sys.version_info >= (3, 8):
        def __init__(
            self,
            pool: Pool,
            chunksize: int,
            length: int,
            callback: Callable[[list[_T]], object] | None,
            error_callback: Callable[[BaseException], object] | None,
        ) -> None: ...
    else:
        def __init__(
            self,
            cache: dict[int, ApplyResult[Any]],
            chunksize: int,
            length: int,
            callback: Callable[[list[_T]], object] | None,
            error_callback: Callable[[BaseException], object] | None,
        ) -> None: ...

class IMapIterator(Iterator[_T]):
    if sys.version_info >= (3, 8):
        def __init__(self, pool: Pool) -> None: ...
    else:
        def __init__(self, cache: dict[int, IMapIterator[Any]]) -> None: ...

    def __iter__(self) -> Self: ...
    def next(self, timeout: float | None = None) -> _T: ...
    def __next__(self, timeout: float | None = None) -> _T: ...

class IMapUnorderedIterator(IMapIterator[_T]): ...

class Pool:
    def __init__(
        self,
        processes: int | None = None,
        initializer: Callable[..., object] | None = None,
        initargs: Iterable[Any] = (),
        maxtasksperchild: int | None = None,
        context: Any | None = None,
    ) -> None: ...
    def apply(self, func: Callable[..., _T], args: Iterable[Any] = (), kwds: Mapping[str, Any] = {}) -> _T: ...
    def apply_async(
        self,
        func: Callable[..., _T],
        args: Iterable[Any] = (),
        kwds: Mapping[str, Any] = {},
        callback: Callable[[_T], object] | None = None,
        error_callback: Callable[[BaseException], object] | None = None,
    ) -> AsyncResult[_T]: ...
    def map(self, func: Callable[[_S], _T], iterable: Iterable[_S], chunksize: int | None = None) -> list[_T]: ...
    def map_async(
        self,
        func: Callable[[_S], _T],
        iterable: Iterable[_S],
        chunksize: int | None = None,
        callback: Callable[list[_T], object] | None = None,
        error_callback: Callable[[BaseException], object] | None = None,
    ) -> MapResult[_T]: ...
    def imap(self, func: Callable[[_S], _T], iterable: Iterable[_S], chunksize: int | None = 1) -> IMapIterator[_T]: ...
    def imap_unordered(self, func: Callable[[_S], _T], iterable: Iterable[_S], chunksize: int | None = 1) -> IMapIterator[_T]: ...
    def starmap(self, func: Callable[..., _T], iterable: Iterable[Iterable[Any]], chunksize: int | None = None) -> list[_T]: ...
    def starmap_async(
        self,
        func: Callable[..., _T],
        iterable: Iterable[Iterable[Any]],
        chunksize: int | None = None,
        callback: Callable[list[_T], object] | None = None,
        error_callback: Callable[[BaseException], object] | None = None,
    ) -> AsyncResult[list[_T]]: ...
    def close(self) -> None: ...
    def terminate(self) -> None: ...
    def join(self) -> None: ...
    def __enter__(self) -> Self: ...
    def __exit__(
        self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: TracebackType | None
    ) -> None: ...

class ThreadPool(Pool):
    def __init__(
        self, processes: int | None = None, initializer: Callable[..., object] | None = None, initargs: Iterable[Any] = ()
    ) -> None: ...

# undocumented
if sys.version_info >= (3, 8):
    INIT: Literal["INIT"]
    RUN: Literal["RUN"]
    CLOSE: Literal["CLOSE"]
    TERMINATE: Literal["TERMINATE"]
else:
    RUN: Literal[0]
    CLOSE: Literal[1]
    TERMINATE: Literal[2]
