from typing import Optional, Text

from google.protobuf.message import Message

class SourceContext(Message):
    file_name: Text
    def __init__(self, file_name: Optional[Text] = ...) -> None: ...
