from _typeshed import Incomplete
from typing import NamedTuple

def open_zip(path): ...

HEADER_FORMAT: str
HEADER_SIGNATURE: bytes
NO_COMPRESSION: int
DEFLATED: int

class ZipHeader(NamedTuple):
    signature: Incomplete
    extract_by: Incomplete
    flags: Incomplete
    compression: Incomplete
    time: Incomplete
    date: Incomplete
    crc: Incomplete
    compressed: Incomplete
    uncompressed: Incomplete
    name: Incomplete
    extra: Incomplete

def decode_name(name): ...
def read_zip_header(file): ...
def is_zip_header(record): ...
def assert_zip_header(record) -> None: ...
def read_zip_data(file, header): ...
