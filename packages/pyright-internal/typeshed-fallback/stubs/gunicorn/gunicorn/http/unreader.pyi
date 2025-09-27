import io
import socket
from _typeshed import ReadableBuffer
from collections.abc import Iterable, Iterator
from typing_extensions import override

class Unreader:
    buf: io.BytesIO

    def __init__(self) -> None: ...
    def chunk(self) -> bytes: ...
    def read(self, size: int | None = None) -> bytes: ...
    def unread(self, data: ReadableBuffer) -> None: ...

class SocketUnreader(Unreader):
    sock: socket.socket
    mxchunk: int

    def __init__(self, sock: socket.socket, max_chunk: int = 8192) -> None: ...
    @override
    def chunk(self) -> bytes: ...

class IterUnreader(Unreader):
    iter: Iterator[bytes] | None

    def __init__(self, iterable: Iterable[bytes]) -> None: ...
    @override
    def chunk(self) -> bytes: ...
