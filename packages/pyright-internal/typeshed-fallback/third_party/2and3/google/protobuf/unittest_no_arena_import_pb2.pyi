from typing import Optional

from google.protobuf.message import Message

class ImportNoArenaNestedMessage(Message):
    d: int
    def __init__(self, d: Optional[int] = ...) -> None: ...
