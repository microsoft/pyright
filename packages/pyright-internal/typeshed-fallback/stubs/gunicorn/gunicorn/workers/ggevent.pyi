from types import FrameType
from typing import Any, ClassVar
from typing_extensions import override

from gevent import pywsgi
from gevent.pywsgi import WSGIHandler
from gevent.server import StreamServer
from gevent.socket import socket as GeventSocket
from gunicorn.http import Request
from gunicorn.workers.base_async import AsyncWorker

from .._types import _AddressType

VERSION: str

class GeventWorker(AsyncWorker):
    server_class: ClassVar[type[StreamServer] | None]
    wsgi_handler: ClassVar[type[WSGIHandler] | None]
    sockets: list[GeventSocket]

    def patch(self) -> None: ...
    @override
    def notify(self) -> None: ...
    @override
    def timeout_ctx(self) -> None: ...
    @override
    def run(self) -> None: ...
    @override
    def handle(self, listener: GeventSocket, client: GeventSocket, addr: _AddressType) -> None: ...
    @override
    def handle_request(self, listener_name: str, req: Request, sock: GeventSocket, addr: _AddressType) -> bool: ...
    @override
    def handle_quit(self, sig: int, frame: FrameType | None) -> None: ...
    @override
    def handle_usr1(self, sig: int, frame: FrameType | None) -> None: ...
    @override
    def init_process(self) -> None: ...

class GeventResponse:
    status: ClassVar[str | None]
    headers: ClassVar[dict[str, str] | None]
    sent: ClassVar[int | None]

    def __init__(self, status: str, headers: dict[str, str], clength: int | None) -> None: ...

class PyWSGIHandler(pywsgi.WSGIHandler):
    def log_request(self) -> None: ...
    def get_environ(self) -> dict[str, Any]: ...

class PyWSGIServer(pywsgi.WSGIServer): ...

class GeventPyWSGIWorker(GeventWorker):
    server_class: ClassVar[type[PyWSGIServer] | None]
    wsgi_handler: ClassVar[type[PyWSGIHandler] | None]
