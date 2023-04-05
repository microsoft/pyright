from collections.abc import Iterable, Mapping, Sequence
from typing import Any
from typing_extensions import TypeAlias

from . import fields

RequestField = fields.RequestField

writer: Any

_TYPE_FIELDS_SEQUENCE: TypeAlias = Sequence[tuple[str, fields._FieldValueTuple] | RequestField]
_TYPE_FIELDS: TypeAlias = _TYPE_FIELDS_SEQUENCE | Mapping[str, fields._FieldValueTuple]

def choose_boundary() -> str: ...
def iter_field_objects(fields: _TYPE_FIELDS) -> Iterable[RequestField]: ...
def iter_fields(fields): ...
def encode_multipart_formdata(fields: _TYPE_FIELDS, boundary: str | None = None) -> tuple[bytes, str]: ...
