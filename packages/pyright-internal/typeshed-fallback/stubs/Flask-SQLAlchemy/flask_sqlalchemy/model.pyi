from re import Pattern
from typing import Any

from sqlalchemy.ext.declarative import DeclarativeMeta

def should_set_tablename(cls: type) -> bool: ...

camelcase_re: Pattern[str]

def camel_to_snake_case(name: str) -> str: ...

class NameMetaMixin(type):
    def __init__(cls, name, bases, d) -> None: ...
    def __table_cls__(cls, *args, **kwargs): ...

class BindMetaMixin(type):
    def __init__(cls, name, bases, d) -> None: ...

class DefaultMeta(NameMetaMixin, BindMetaMixin, DeclarativeMeta): ...

class Model:
    query_class: Any | None
    query: Any | None
