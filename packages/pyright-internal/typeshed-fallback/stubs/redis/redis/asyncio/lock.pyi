import threading
from _typeshed import Self
from collections.abc import Awaitable
from types import SimpleNamespace, TracebackType
from typing import Any, ClassVar

from redis.asyncio import Redis
from redis.commands.core import AsyncScript

class Lock:
    lua_release: ClassVar[AsyncScript | None]
    lua_extend: ClassVar[AsyncScript | None]
    lua_reacquire: ClassVar[AsyncScript | None]
    LUA_RELEASE_SCRIPT: ClassVar[str]
    LUA_EXTEND_SCRIPT: ClassVar[str]
    LUA_REACQUIRE_SCRIPT: ClassVar[str]
    redis: Redis[Any]
    name: str | bytes | memoryview
    timeout: float | None
    sleep: float
    blocking: bool
    blocking_timeout: float | None
    thread_local: bool
    local: threading.local | SimpleNamespace
    def __init__(
        self,
        redis: Redis[Any],
        name: str | bytes | memoryview,
        timeout: float | None = ...,
        sleep: float = ...,
        blocking: bool = ...,
        blocking_timeout: float | None = ...,
        thread_local: bool = ...,
    ) -> None: ...
    def register_scripts(self) -> None: ...
    async def __aenter__(self: Self) -> Self: ...
    async def __aexit__(
        self, exc_type: type[BaseException] | None, exc_val: BaseException | None, exc_tb: TracebackType | None
    ) -> None: ...
    async def acquire(
        self, blocking: bool | None = ..., blocking_timeout: float | None = ..., token: str | bytes | None = ...
    ) -> bool: ...
    async def do_acquire(self, token: str | bytes) -> bool: ...
    async def locked(self) -> bool: ...
    async def owned(self) -> bool: ...
    def release(self) -> Awaitable[None]: ...
    async def do_release(self, expected_token: bytes) -> None: ...
    def extend(self, additional_time: float, replace_ttl: bool = ...) -> Awaitable[bool]: ...
    async def do_extend(self, additional_time: float, replace_ttl: bool) -> bool: ...
    def reacquire(self) -> Awaitable[bool]: ...
    async def do_reacquire(self) -> bool: ...
