from typing import Optional

from google.protobuf.internal import well_known_types
from google.protobuf.message import Message

class Timestamp(Message, well_known_types.Timestamp):
    seconds: int
    nanos: int
    def __init__(self, seconds: Optional[int] = ..., nanos: Optional[int] = ...) -> None: ...
