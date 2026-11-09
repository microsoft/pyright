from _typeshed import Incomplete
from collections.abc import Callable

from ._distutils.errors import DistutilsError

__all__ = [
    "UnrecognizedFormat",
    "UnsafeMember",
    "default_filter",
    "extraction_drivers",
    "unpack_archive",
    "unpack_directory",
    "unpack_tarfile",
    "unpack_zipfile",
]

class UnrecognizedFormat(DistutilsError): ...
class UnsafeMember(DistutilsError): ...

def default_filter(src, dst): ...
def unpack_archive(filename, extract_dir, progress_filter=..., drivers=None) -> None: ...
def unpack_directory(filename, extract_dir, progress_filter=...) -> None: ...
def unpack_zipfile(filename, extract_dir, progress_filter=...) -> None: ...
def unpack_tarfile(filename, extract_dir, progress_filter=...): ...

extraction_drivers: tuple[Callable[..., Incomplete], ...]
