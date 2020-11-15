# This sample tests the handling of type variables
# used within a generic class.

from queue import Queue
from typing import Generic, Optional, TypeVar

_T = TypeVar("_T")


class Foo(Generic[_T]):
    def __init__(self):
        self._queue: "Queue[Optional[_T]]" = Queue()

    def publish(self, message: _T):
        self._queue.put_nowait(message)
