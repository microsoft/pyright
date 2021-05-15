from typing import Any, Dict, Optional, Text, TypeVar, Union

from google.protobuf.descriptor_pool import DescriptorPool
from google.protobuf.message import Message

_MessageT = TypeVar("_MessageT", bound=Message)

class Error(Exception): ...
class ParseError(Error): ...
class SerializeToJsonError(Error): ...

def MessageToJson(
    message: Message,
    including_default_value_fields: bool = ...,
    preserving_proto_field_name: bool = ...,
    indent: int = ...,
    sort_keys: bool = ...,
    use_integers_for_enums: bool = ...,
    descriptor_pool: Optional[DescriptorPool] = ...,
    float_precision: Optional[int] = ...,
) -> str: ...
def MessageToDict(
    message: Message,
    including_default_value_fields: bool = ...,
    preserving_proto_field_name: bool = ...,
    use_integers_for_enums: bool = ...,
    descriptor_pool: Optional[DescriptorPool] = ...,
    float_precision: Optional[int] = ...,
) -> Dict[Text, Any]: ...
def Parse(
    text: Union[bytes, Text],
    message: _MessageT,
    ignore_unknown_fields: bool = ...,
    descriptor_pool: Optional[DescriptorPool] = ...,
) -> _MessageT: ...
def ParseDict(
    js_dict: Any, message: _MessageT, ignore_unknown_fields: bool = ..., descriptor_pool: Optional[DescriptorPool] = ...
) -> _MessageT: ...
