# This sample tests the case where a generic class declaration refers
# to itself. This case should arguably be considered an error, but
# it does appear within the stdlib typeshed stubs (see os.scandir).

from os import DirEntry
from typing import AnyStr, ContextManager, Iterator


class _ScandirIterator(
    Iterator[DirEntry[AnyStr]], ContextManager["_ScandirIterator[AnyStr]"]
):
    def __next__(self) -> DirEntry[AnyStr]:
        ...

    def close(self) -> None:
        ...


def scandir(path: AnyStr) -> _ScandirIterator[AnyStr]:
    ...


def thing(value: AnyStr):
    with scandir(value) as it:
        for file in it:
            if isinstance(file.name, str):
                if file.name.endswith(".xml"):
                    ...
            else:
                if file.name.endswith(b".xml"):
                    ...
