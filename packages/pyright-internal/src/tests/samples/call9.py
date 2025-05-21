# This sample tests the case where a dictionary expansion operator
# is used in a call. The type checker should verify that the
# type supports a SupportsKeyAndGetItem protocol.

from typing import Any, Generic, Iterator, TypeVar, Mapping, KeysView


class MyMapping(Mapping[str, Any]):
    def __getitem__(self, __key: str) -> Any: ...

    def __iter__(self) -> Iterator[str]: ...

    def __len__(self) -> int: ...


class StrRecord:
    def __getitem__(self, __key: str) -> str: ...

    def keys(self) -> KeysView[str]: ...


T = TypeVar("T")


class GenericRecord(Generic[T]):
    def __getitem__(self, __key: str) -> T: ...

    def keys(self) -> KeysView[T]: ...


def func1(**kwargs: Any) -> None: ...


m = MyMapping()
r = StrRecord()


def func2(
    m: MyMapping,
    r: StrRecord,
    g: GenericRecord[str],
    mrg: MyMapping | StrRecord | GenericRecord[str],
    bad: GenericRecord[bytes],
):
    func1(**m)
    func1(**r)
    func1(**g)
    func1(**mrg)

    # This should generate an error.
    func1(**bad)
