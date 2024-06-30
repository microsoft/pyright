# This sample tests the assignment of generic classes to
# a generic protocol in the case where the protocol is
# satisfied by a generic subclass.

from typing import Generic, Iterator, Optional, TypeVar


class Base:
    pass


_T1 = TypeVar("_T1")
_TBase1 = TypeVar("_TBase1", bound=Base)
_TBase2 = TypeVar("_TBase2", bound=Base)


def my_next(__i: Iterator[_T1]) -> _T1: ...


class SourceProvider(Generic[_TBase1]):
    def __iter__(self):
        return self


class ManagedSourceProvider(SourceProvider[_TBase2]):
    def get(self) -> Optional[_TBase2]:
        source = my_next(self)
        return source

    def __next__(self) -> _TBase2:
        raise NotImplementedError
