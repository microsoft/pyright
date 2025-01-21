from collections.abc import Mapping
from datetime import datetime
from typing import Any, ClassVar, Generic, TypeVar

from django.db.models import Model, QuerySet

def format_datetime(value: datetime, datetime_format: str) -> str: ...

class Widget:
    def clean(self, value: Any, row: Mapping[str, Any] | None = None, **kwargs: Any) -> Any: ...
    def render(self, value: Any, obj: Model | None = None) -> Any: ...

class NumberWidget(Widget):
    coerce_to_string: bool
    def __init__(self, coerce_to_string: bool = False) -> None: ...
    def is_empty(self, value: Any) -> bool: ...
    def render(self, value: Any, obj: Model | None = None) -> Any: ...

class FloatWidget(NumberWidget): ...
class IntegerWidget(NumberWidget): ...
class DecimalWidget(NumberWidget): ...

class CharWidget(Widget):
    coerce_to_string: bool
    allow_blank: bool
    def __init__(self, coerce_to_string: bool = False, allow_blank: bool = False) -> None: ...

class BooleanWidget(Widget):
    TRUE_VALUES: ClassVar[list[str | int | bool]]
    FALSE_VALUES: ClassVar[list[str | int | bool]]
    NULL_VALUES: ClassVar[list[str | None]]

class DateWidget(Widget):
    formats: tuple[str, ...]
    def __init__(self, format: str | None = None) -> None: ...

class DateTimeWidget(Widget):
    formats: tuple[str, ...]
    def __init__(self, format: str | None = None) -> None: ...

class TimeWidget(Widget):
    formats: tuple[str, ...]
    def __init__(self, format: str | None = None) -> None: ...

class DurationWidget(Widget): ...

class SimpleArrayWidget(Widget):
    separator: str
    def __init__(self, separator: str | None = None) -> None: ...

class JSONWidget(Widget): ...

_ModelT = TypeVar("_ModelT", bound=Model)

class ForeignKeyWidget(Widget, Generic[_ModelT]):
    model: _ModelT
    field: str
    use_natural_foreign_keys: bool
    def __init__(self, model: _ModelT, field: str = "pk", use_natural_foreign_keys: bool = False, **kwargs: Any) -> None: ...
    def get_queryset(self, value: Any, row: Mapping[str, Any], *args: Any, **kwargs: Any) -> QuerySet[_ModelT]: ...

class ManyToManyWidget(Widget, Generic[_ModelT]):
    model: _ModelT
    separator: str
    field: str
    def __init__(self, model: _ModelT, separator: str | None = None, field: str | None = None, **kwargs: Any) -> None: ...
