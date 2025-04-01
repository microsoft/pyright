# This sample tests the case where a generic class declaration refers
# to itself. This case should arguably be considered an error, but
# it does appear within the stdlib typeshed stubs (see os.scandir).

from os import DirEntry
from types import TracebackType
from typing import AnyStr, ContextManager, Iterator
from typing_extensions import Self  # pyright: ignore[reportMissingModuleSource]


class _ScandirIterator(
    Iterator[DirEntry[AnyStr]], ContextManager["_ScandirIterator[AnyStr]"]
):
    def __iter__(self) -> Self: ...

    def __next__(self) -> DirEntry[AnyStr]: ...

    def close(self) -> None: ...

    def __enter__(self) -> Self: ...

    def __exit__(
        self,
        __exc_type: type[BaseException] | None,
        __exc_value: BaseException | None,
        __traceback: TracebackType | None,
    ) -> bool | None: ...


def scandir(path: AnyStr) -> _ScandirIterator[AnyStr]: ...


def thing(value: AnyStr):
    with scandir(value) as it:
        for file in it:
            if isinstance(file.name, str):
                if file.name.endswith(".xml"):
                    ...
            elif isinstance(file.name, bytes):
                if file.name.endswith(b".xml"):
                    ...
