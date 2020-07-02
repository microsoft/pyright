from typing import Any

# from .packages import six
from . import fields, packages

# six = packages.six
# b = six.b
RequestField = fields.RequestField

writer: Any

def choose_boundary(): ...
def iter_field_objects(fields): ...
def iter_fields(fields): ...
def encode_multipart_formdata(fields, boundary=...): ...
