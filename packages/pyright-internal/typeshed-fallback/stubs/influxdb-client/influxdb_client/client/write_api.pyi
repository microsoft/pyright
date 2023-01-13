from _typeshed import Incomplete
from collections.abc import Iterable
from enum import Enum
from typing import Any
from typing_extensions import TypeAlias

from influxdb_client.client._base import _BaseWriteApi
from influxdb_client.client.write.point import Point
from influxdb_client.domain.write_precision import _WritePrecision

_DataClass: TypeAlias = Any  # any dataclass
_NamedTuple: TypeAlias = tuple[Any, ...]  # any NamedTuple
_Observable: TypeAlias = Any  # reactivex.Observable

logger: Incomplete

class WriteType(Enum):
    batching: int
    asynchronous: int
    synchronous: int

class WriteOptions:
    write_type: Incomplete
    batch_size: Incomplete
    flush_interval: Incomplete
    jitter_interval: Incomplete
    retry_interval: Incomplete
    max_retries: Incomplete
    max_retry_delay: Incomplete
    max_retry_time: Incomplete
    exponential_base: Incomplete
    write_scheduler: Incomplete
    def __init__(
        self,
        write_type: WriteType = ...,
        batch_size: int = ...,
        flush_interval: int = ...,
        jitter_interval: int = ...,
        retry_interval: int = ...,
        max_retries: int = ...,
        max_retry_delay: int = ...,
        max_retry_time: int = ...,
        exponential_base: int = ...,
        write_scheduler=...,
    ) -> None: ...
    def to_retry_strategy(self, **kwargs): ...

SYNCHRONOUS: Incomplete
ASYNCHRONOUS: Incomplete

class PointSettings:
    defaultTags: Incomplete
    def __init__(self, **default_tags) -> None: ...
    def add_default_tag(self, key, value) -> None: ...

class _BatchItemKey:
    bucket: Incomplete
    org: Incomplete
    precision: Incomplete
    def __init__(self, bucket, org, precision=...) -> None: ...
    def __hash__(self) -> int: ...
    def __eq__(self, o: object) -> bool: ...

class _BatchItem:
    key: Incomplete
    data: Incomplete
    size: Incomplete
    def __init__(self, key: _BatchItemKey, data, size: int = ...) -> None: ...
    def to_key_tuple(self) -> tuple[str, str, str]: ...

class _BatchResponse:
    data: Incomplete
    exception: Incomplete
    def __init__(self, data: _BatchItem, exception: Exception | None = ...) -> None: ...

class WriteApi(_BaseWriteApi):
    def __init__(
        self, influxdb_client, write_options: WriteOptions = ..., point_settings: PointSettings = ..., **kwargs
    ) -> None: ...
    def write(
        self,
        bucket: str,
        org: str | None = ...,
        record: str
        | Iterable[str]
        | Point
        | Iterable[Point]
        | dict[Incomplete, Incomplete]
        | Iterable[dict[Incomplete, Incomplete]]
        | bytes
        | Iterable[bytes]
        | _Observable
        | _NamedTuple
        | Iterable[_NamedTuple]
        | _DataClass
        | Iterable[_DataClass] = ...,
        write_precision: _WritePrecision = ...,
        **kwargs,
    ) -> Any: ...
    def flush(self) -> None: ...
    def close(self) -> None: ...
    def __enter__(self): ...
    def __exit__(self, exc_type, exc_val, exc_tb) -> None: ...
    def __del__(self) -> None: ...
