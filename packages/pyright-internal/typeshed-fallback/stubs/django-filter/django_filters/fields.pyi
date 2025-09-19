from collections.abc import Sequence
from typing import Any, NamedTuple
from typing_extensions import TypeAlias

from django import forms

DJANGO_50: bool

# Ref: django-stubs/forms/fields.pyi
# Problem: attribute `widget` is always of type `Widget` after field instantiation.
# However, on class level it can be set to `Type[Widget]` too.
# If we annotate it as `Union[Widget, Type[Widget]]`, every code that uses field
# instances will not typecheck.
# If we annotate it as `Widget`, any widget subclasses that do e.g.
# `widget = Select` will not typecheck.
# `Any` gives too much freedom, but does not create false positives.
_ClassLevelWidget: TypeAlias = Any

class RangeField(forms.MultiValueField):
    widget: _ClassLevelWidget = ...
    def __init__(
        self, fields: tuple[forms.Field, forms.Field] | None = None, *args: Any, **kwargs: Any
    ) -> None: ...  # Args/kwargs can be any field params, passes to parent
    def compress(self, data_list: list[Any] | None) -> slice | None: ...  # Data list elements can be any field value type

class DateRangeField(RangeField):
    widget: _ClassLevelWidget = ...
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...  # Args/kwargs can be any field params for parent
    def compress(self, data_list: list[Any] | None) -> slice | None: ...  # Date values in list can be any date type

class DateTimeRangeField(RangeField):
    widget: _ClassLevelWidget = ...
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...  # Args/kwargs can be any field params for parent

class IsoDateTimeRangeField(RangeField):
    widget: _ClassLevelWidget = ...
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...  # Args/kwargs can be any field params for parent

class TimeRangeField(RangeField):
    widget: _ClassLevelWidget = ...
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...  # Args/kwargs can be any field params for parent

class Lookup(NamedTuple):
    value: Any  # Lookup values can be any filterable type
    lookup_expr: str

class LookupChoiceField(forms.MultiValueField):
    def __init__(
        self, field: forms.Field, lookup_choices: Sequence[tuple[str, str]], *args: Any, **kwargs: Any
    ) -> None: ...  # Args/kwargs can be any field params, uses kwargs for empty_label
    def compress(self, data_list: list[Any] | None) -> Lookup | None: ...  # Data list can contain any lookup components

class IsoDateTimeField(forms.DateTimeField):
    ISO_8601: str
    input_formats: list[str]
    def strptime(self, value: str, format: str) -> Any: ...  # Returns datetime objects or parsing results

class BaseCSVField(forms.Field):
    base_widget_class: _ClassLevelWidget = ...
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...  # Args/kwargs can be any field params for widget config
    def clean(self, value: Any) -> Any: ...  # Cleaned values can be any valid field type

class BaseRangeField(BaseCSVField):
    widget: _ClassLevelWidget = ...
    def clean(self, value: Any) -> Any: ...  # Input and output values can be any range type

class ChoiceIterator:
    field: ChoiceField
    choices: Sequence[tuple[Any, str]]  # Choice values can be any type (int, str, Model, etc.)
    def __init__(
        self, field: ChoiceField, choices: Sequence[tuple[Any, str]]
    ) -> None: ...  # Choice values can be any selectable type
    def __iter__(self) -> Any: ...  # Iterator yields choice tuples with any value types
    def __len__(self) -> int: ...

class ModelChoiceIterator(forms.models.ModelChoiceIterator):
    def __iter__(self) -> Any: ...  # Iterator yields choice tuples with any value types
    def __len__(self) -> int: ...

class ChoiceIteratorMixin:
    null_label: str | None
    null_value: Any  # Null choice values can be any type (None, empty string, etc.)
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...  # Args/kwargs can be any field params for null config

class ChoiceField(ChoiceIteratorMixin, forms.ChoiceField):
    iterator = ChoiceIterator
    empty_label: str | None
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...  # Args/kwargs can be any field params for label config

class MultipleChoiceField(ChoiceIteratorMixin, forms.MultipleChoiceField):
    iterator = ChoiceIterator
    empty_label: str | None
    def __init__(self, *args: Any, **kwargs: Any) -> None: ...  # Args/kwargs can be any field params, sets empty_label

class ModelChoiceField(ChoiceIteratorMixin, forms.ModelChoiceField[Any]):
    iterator = ModelChoiceIterator
    def to_python(self, value: Any) -> Any: ...  # Converts any input to Python model objects or values

class ModelMultipleChoiceField(ChoiceIteratorMixin, forms.ModelMultipleChoiceField[Any]):
    iterator = ModelChoiceIterator
