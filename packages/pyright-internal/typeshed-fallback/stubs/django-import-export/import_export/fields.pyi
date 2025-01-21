from collections.abc import Callable, Mapping
from typing import Any, ClassVar

from django.db.models import Model
from django.db.models.fields import NOT_PROVIDED

from .widgets import Widget

class Field:
    empty_values: ClassVar[list[str | None]]
    attribute: str | None
    default: type[NOT_PROVIDED] | Callable[[], Any] | Any
    column_name: str | None
    widget: Widget
    readonly: bool
    saves_null_values: bool
    dehydrate_method: str
    m2m_add: bool
    def __init__(
        self,
        attribute: str | None = None,
        column_name: str | None = None,
        widget: Widget | None = None,
        default: type[NOT_PROVIDED] | Callable[[], Any] | Any = ...,
        readonly: bool = False,
        saves_null_values: bool = True,
        dehydrate_method: str | None = None,
        m2m_add: bool = False,
    ) -> None: ...
    def clean(self, data: Mapping[str, Any], **kwargs: Any) -> Any: ...
    def get_value(self, obj: Model) -> Any: ...
    def save(self, obj: Model, data: Mapping[str, Any], is_m2m: bool = False, **kwargs: Any) -> None: ...
    def export(self, obj: Model) -> str: ...
    def get_dehydrate_method(self, field_name: str | None = None) -> str: ...
