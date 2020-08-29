from typing import Optional

from google.protobuf.message import Message

class PublicImportMessage(Message):
    e: int
    def __init__(self, e: Optional[int] = ...) -> None: ...
