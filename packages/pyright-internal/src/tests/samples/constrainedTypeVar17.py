# This sample tests the case where a constrained TypeVar
# is used in a protocol with a contravariant TypeVar.

# This example is a stand-alone sample based on the following code.
# with open('read', 'rb') as fr, open('write', 'wb') as fw:
#     shutil.copyfileobj(fr, fw)

from typing import Any, AnyStr, Optional, Protocol, TypeVar, Union


class Array: ...


class MMap: ...


# Note that this union contains types that are not compatible
# with the type "bytes".
ReadableBuffer = Union[bytes, bytearray, memoryview, Array, MMap]

_T_contra = TypeVar("_T_contra", contravariant=True)
_T_co = TypeVar("_T_co", covariant=True)


class BufferedWriter:
    def write(self, __buffer: ReadableBuffer) -> int: ...


class SupportsWrite(Protocol[_T_contra]):
    def write(self, __s: _T_contra) -> Any: ...


class SupportsRead(Protocol[_T_co]):
    def read(self, __length: int = ...) -> _T_co: ...


class BufferedReader:
    def read(self, __size: Optional[int] = ...) -> bytes: ...


def copyfileobj(
    fsrc: SupportsRead[AnyStr], fdst: SupportsWrite[AnyStr], length: int = ...
) -> AnyStr: ...


def f(fr: BufferedReader, fw: BufferedWriter):
    x = copyfileobj(fr, fw)
    reveal_type(x, expected_text="bytes")
