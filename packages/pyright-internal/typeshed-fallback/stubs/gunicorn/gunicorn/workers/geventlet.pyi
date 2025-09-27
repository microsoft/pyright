from types import FrameType
from typing import Any
from typing_extensions import TypeAlias, override

from gunicorn.workers.base_async import AsyncWorker

from .._types import _AddressType

GreenSocket: TypeAlias = Any  # eventlet GreenSocket class

EVENTLET_WSGI_LOCAL: Any  # eventlet local instance
EVENTLET_ALREADY_HANDLED: bool | None

def patch_sendfile() -> None: ...

class EventletWorker(AsyncWorker):
    def patch(self) -> None: ...
    @override
    def is_already_handled(self, respiter: object) -> bool: ...
    @override
    def init_process(self) -> None: ...
    @override
    def handle_quit(self, sig: int, frame: FrameType | None) -> None: ...
    @override
    def handle_usr1(self, sig: int, frame: FrameType | None) -> None: ...
    @override
    def timeout_ctx(self) -> None: ...
    @override
    def handle(self, listener: GreenSocket, client: GreenSocket, addr: _AddressType) -> None: ...
    @override
    def run(self) -> None: ...
