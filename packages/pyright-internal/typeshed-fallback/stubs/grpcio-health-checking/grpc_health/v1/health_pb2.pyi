from typing import ClassVar, Literal, final

from google._upb._message import Descriptor, FileDescriptor, MessageMeta
from google.protobuf import message
from google.protobuf.internal.enum_type_wrapper import EnumTypeWrapper

DESCRIPTOR: FileDescriptor

@final
class HealthCheckRequest(message.Message, metaclass=MessageMeta):
    SERVICE_FIELD_NUMBER: ClassVar[int]
    service: str
    def __init__(self, service: str | None = ...) -> None: ...
    DESCRIPTOR: Descriptor

@final
class HealthCheckResponse(message.Message, metaclass=MessageMeta):
    ServingStatus: ClassVar[EnumTypeWrapper]
    UNKNOWN: ClassVar[Literal[0]]
    SERVING: ClassVar[Literal[1]]
    NOT_SERVING: ClassVar[Literal[2]]
    SERVICE_UNKNOWN: ClassVar[Literal[3]]
    STATUS_FIELD_NUMBER: ClassVar[int]
    status: int
    def __init__(self, status: int | str | None = ...) -> None: ...
    DESCRIPTOR: Descriptor
