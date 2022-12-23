from _typeshed import Incomplete

logger: Incomplete

class IfdTag:
    printable: Incomplete
    tag: Incomplete
    field_type: Incomplete
    field_offset: Incomplete
    field_length: Incomplete
    values: Incomplete
    def __init__(self, printable: str, tag: int, field_type: int, values, field_offset: int, field_length: int) -> None: ...

class ExifHeader:
    file_handle: Incomplete
    endian: Incomplete
    offset: Incomplete
    fake_exif: Incomplete
    strict: Incomplete
    debug: Incomplete
    detailed: Incomplete
    truncate_tags: Incomplete
    tags: Incomplete
    def __init__(
        self,
        file_handle,
        endian,
        offset,
        fake_exif,
        strict: bool,
        debug: bool = ...,
        detailed: bool = ...,
        truncate_tags: bool = ...,
    ) -> None: ...
    def s2n(self, offset, length: int, signed: bool = ...) -> int: ...
    def n2b(self, offset, length) -> bytes: ...
    def list_ifd(self) -> list[Incomplete]: ...
    def dump_ifd(self, ifd, ifd_name: str, tag_dict: Incomplete | None = ..., relative: int = ..., stop_tag=...) -> None: ...
    def extract_tiff_thumbnail(self, thumb_ifd: int) -> None: ...
    def extract_jpeg_thumbnail(self) -> None: ...
    def decode_maker_note(self) -> None: ...
    def parse_xmp(self, xmp_bytes: bytes): ...
