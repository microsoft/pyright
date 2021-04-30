from _typeshed import OpenBinaryModeReading, OpenBinaryModeWriting, OpenTextModeReading, OpenTextModeWriting
from typing import Any, ClassVar, Optional, Union

from docutils import TransformSpec

__docformat__: str

class InputError(IOError): ...
class OutputError(IOError): ...

def check_encoding(stream: Any, encoding: str) -> Optional[bool]: ...

class Input(TransformSpec):
    component_type: ClassVar[str]
    default_source_path: ClassVar[Optional[str]]
    def read(self) -> Any: ...
    def __getattr__(self, name: str) -> Any: ...  # incomplete

class Output(TransformSpec):
    component_type: ClassVar[str]
    default_destination_path: ClassVar[Optional[str]]
    def __init__(
        self,
        destination: Optional[Any] = ...,
        destination_path: Optional[Any] = ...,
        encoding: Optional[str] = ...,
        error_handler: str = ...,
    ) -> None: ...
    def write(self, data: str) -> Any: ...  # returns bytes or str
    def encode(self, data: str) -> Any: ...  # returns bytes or str

class FileInput(Input):
    def __init__(
        self,
        source: Optional[Any] = ...,
        source_path: Optional[Any] = ...,
        encoding: Optional[str] = ...,
        error_handler: str = ...,
        autoclose: bool = ...,
        mode: Union[OpenTextModeReading, OpenBinaryModeReading] = ...,
    ) -> None: ...
    def readlines(self) -> list[str]: ...
    def close(self) -> None: ...

class FileOutput(Output):
    mode: ClassVar[Union[OpenTextModeWriting, OpenBinaryModeWriting]]
    def __getattr__(self, name: str) -> Any: ...  # incomplete

class BinaryFileOutput(FileOutput): ...

class StringInput(Input):
    default_source_path: ClassVar[str]

class StringOutput(Output):
    default_destination_path: ClassVar[str]
    destination: Union[str, bytes]  # only defined after call to write()

class NullInput(Input):
    default_source_path: ClassVar[str]
    def read(self) -> str: ...

class NullOutput(Output):
    default_destination_path: ClassVar[str]
    def write(self, data: object) -> None: ...

class DocTreeInput(Input):
    default_source_path: ClassVar[str]
