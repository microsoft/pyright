from decimal import Decimal
from typing import Any, Literal, TypeAlias

from markupsafe import Markup
from wtforms.datalist import DataList
from wtforms.fields import Field, FormField, StringField
from wtforms.fields.choices import Choice, SelectFieldBase, _Option

__all__ = (
    "Button",
    "CheckboxInput",
    "ColorInput",
    "DataListWidget",
    "DateInput",
    "DateTimeInput",
    "DateTimeLocalInput",
    "EmailInput",
    "FileInput",
    "HiddenInput",
    "ListWidget",
    "MonthInput",
    "NumberInput",
    "Option",
    "PasswordInput",
    "RadioInput",
    "RangeInput",
    "SearchInput",
    "Select",
    "SubmitInput",
    "TableWidget",
    "TextArea",
    "TextInput",
    "TelInput",
    "TimeInput",
    "URLInput",
    "WeekInput",
)

# while `render_kw` are generally directly passed to `html_params` some widget
# subclasses may decide to define additional parameters that determine some
# rendering behavior, rather than resulting in a html attribute. Using `object`
# instead of `Any` here would prevent subclasses from strongly typing those
# extra parameters, so we use `Any` to give people more flexibility.
_RenderArg: TypeAlias = Any

# apart from `True` and `False`, which are special-cased, all values get coerced
# to `str` via either the `__html__` method or a conversion via `str()` by
# `markupsafe.escape`.
def html_params(**kwargs: object) -> str: ...

class ListWidget:
    html_tag: Literal["ul", "ol"]
    prefix_label: bool
    def __init__(self, html_tag: Literal["ul", "ol"] = "ul", prefix_label: bool = True) -> None: ...
    # any iterable field is fine, since people might define iterable fields
    # that are not derived from FieldList, we just punt and accept any field
    # with Intersection we could be more specific
    def __call__(self, field: Field, **kwargs: _RenderArg) -> Markup: ...

class TableWidget:
    with_table_tag: bool
    def __init__(self, with_table_tag: bool = True) -> None: ...
    def __call__(self, field: FormField[Any], **kwargs: _RenderArg) -> Markup: ...

class DataListWidget:
    def __call__(self, datalist: DataList, field: Field | None = None, **kwargs: _RenderArg) -> Markup: ...

class Input:
    validation_attrs: list[str]
    input_type: str
    def __init__(self, input_type: str | None = None) -> None: ...
    def __call__(self, field: Field, **kwargs: _RenderArg) -> Markup: ...
    # re-export of the module-scoped function with the same name
    @staticmethod
    def html_params(**kwargs: object) -> str: ...

class Button:
    input_type: str
    validation_attrs: list[str]
    def __init__(self, input_type: str | None = None) -> None: ...
    def __call__(self, field: Field, **kwargs: _RenderArg) -> Markup: ...
    # re-export of the module-scoped function with the same name
    @staticmethod
    def html_params(**kwargs: object) -> str: ...

class TextInput(Input): ...

class PasswordInput(Input):
    hide_value: bool
    def __init__(self, hide_value: bool = True) -> None: ...

class HiddenInput(Input):
    field_flags: dict[str, Any]

class CheckboxInput(Input): ...
class RadioInput(Input): ...

class FileInput(Input):
    multiple: bool
    def __init__(self, multiple: bool = False) -> None: ...

class SubmitInput(Input): ...

class TextArea:
    validation_attrs: list[str]
    def __call__(self, field: StringField, **kwargs: _RenderArg) -> Markup: ...

class Select:
    validation_attrs: list[str]
    multiple: bool
    def __init__(self, multiple: bool = False) -> None: ...
    def __call__(self, field: SelectFieldBase, **kwargs: _RenderArg) -> Markup: ...
    @classmethod
    def render_option(cls, choice: Choice, **kwargs: _RenderArg) -> Markup: ...

class Option:
    def __call__(self, field: _Option, **kwargs: _RenderArg) -> Markup: ...

class SearchInput(Input): ...
class TelInput(Input): ...
class URLInput(Input): ...
class EmailInput(Input): ...
class DateTimeInput(Input): ...
class DateInput(Input): ...
class MonthInput(Input): ...
class WeekInput(Input): ...
class TimeInput(Input): ...
class DateTimeLocalInput(Input): ...

class NumberInput(Input):
    step: Decimal | float | str | None
    min: Decimal | float | str | None
    max: Decimal | float | str | None
    def __init__(
        self,
        step: Decimal | float | str | None = None,
        min: Decimal | float | str | None = None,
        max: Decimal | float | str | None = None,
    ) -> None: ...

class RangeInput(Input): ...
class ColorInput(Input): ...
