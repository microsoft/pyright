from collections.abc import Callable, Sequence
from datetime import date, datetime, time, tzinfo
from typing import Any
from typing_extensions import Self, deprecated

from wtforms.datalist import DataList
from wtforms.fields.core import Field, _Filter, _FormT, _Validator, _Widget
from wtforms.form import BaseForm
from wtforms.meta import DefaultMeta, _SupportsGettextAndNgettext

__all__ = ("DateTimeField", "DateField", "TimeField", "MonthField", "DateTimeLocalField", "WeekField")

@deprecated("Will be removed in WTForms 3.4 use DateTimeLocalField instead")
class DateTimeField(Field):
    format: list[str]
    strptime_format: list[str]
    data: datetime | None
    default: datetime | Callable[[], datetime] | None
    def __init__(
        self,
        label: str | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        format: str | list[str] = "%Y-%m-%d %H:%M:%S",
        invalid_value_message: str | None = None,
        *,
        filters: Sequence[_Filter] = (),
        description: str = "",
        id: str | None = None,
        default: datetime | Callable[[], datetime] | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...

class DateField(DateTimeField):
    data: date | None  # type: ignore[assignment]
    default: date | Callable[[], date] | None  # type: ignore[assignment]
    def __init__(
        self,
        label: str | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        format: str | list[str] = "%Y-%m-%d",
        invalid_value_message: str | None = None,
        *,
        filters: Sequence[_Filter] = (),
        description: str = "",
        id: str | None = None,
        default: date | Callable[[], date] | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...

class TimeField(DateTimeField):
    data: time | None  # type: ignore[assignment]
    default: time | Callable[[], time] | None  # type: ignore[assignment]
    def __init__(
        self,
        label: str | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        format: str | list[str] = "%H:%M",
        invalid_value_message: str | None = None,
        *,
        filters: Sequence[_Filter] = (),
        description: str = "",
        id: str | None = None,
        default: time | Callable[[], time] | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...

class MonthField(DateField):
    def __init__(
        self,
        label: str | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        format: str | list[str] = "%Y-%m",
        *,
        filters: Sequence[_Filter] = (),
        description: str = "",
        id: str | None = None,
        default: time | Callable[[], time] | None = None,
        invalid_value_message: str | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...

class WeekField(DateField):
    def __init__(
        self,
        label: str | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        format: str | list[str] = "%Y-W%W",  # only difference is the default value
        invalid_value_message: str | None = None,
        *,
        filters: Sequence[_Filter] = (),
        description: str = "",
        id: str | None = None,
        default: time | Callable[[], time] | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...

class DateTimeLocalField(DateTimeField):
    def __init__(
        self,
        label: str | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        format: str | list[str] = ...,
        invalid_value_message: str | None = None,
        *,
        tz: tzinfo | Callable[[], tzinfo | None] | None = None,
        filters: Sequence[_Filter] = (),
        description: str = "",
        id: str | None = None,
        default: time | Callable[[], time] | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...
