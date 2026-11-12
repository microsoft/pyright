from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from enum import Enum, EnumMeta
from typing import Any, Literal, NamedTuple, TypeAlias, TypeVar, overload
from typing_extensions import Self, deprecated

from wtforms.datalist import DataList
from wtforms.fields.core import Field, _Filter, _FormT, _Text, _Validator, _Widget
from wtforms.form import BaseForm
from wtforms.meta import DefaultMeta, _SupportsGettextAndNgettext

__all__ = ("SelectField", "Choice", "SelectChoice", "SelectMultipleField", "RadioField")

_FieldT = TypeVar("_FieldT", bound=Field)
_LegacyChoice: TypeAlias = tuple[Any, str] | tuple[Any, str, dict[str, Any]]  # value, label, [render_kw]
_Choice: TypeAlias = SelectChoice | _LegacyChoice
# it's too difficult to get type safety here due to to nested partially invariant collections
_GroupedChoices: TypeAlias = dict[str, Any]  # Any should be Collection[_Choice]
_LegacyChoices: TypeAlias = Iterable[_LegacyChoice] | _GroupedChoices
_LegacyChoicesCallback: TypeAlias = Callable[[], Sequence[_LegacyChoice] | _GroupedChoices]
# For the two argument callback the implementation might depend on a specific form class
# which is perfectly valid, but since parameter types are contravariant, we cannot restrict
# the callback to `BaseForm`, so we use `Any` instead. We could perhaps use the same trick
# as with _Validators leveraging a `Protocol` with an unbound contravariant type parameter
# but I'm not sure it's worth the extra complexity.
_AnyForm: TypeAlias = Any
_SelectChoicesCallback: TypeAlias = Callable[[_AnyForm, _FieldT], Sequence[SelectChoice]] | Callable[[], Sequence[SelectChoice]]
_FullChoice: TypeAlias = Choice | tuple[Any, str, bool, dict[str, Any]]  # value, label, selected, render_kw
_FullGroupedChoices: TypeAlias = tuple[str, Iterable[_FullChoice]]
_Option: TypeAlias = SelectFieldBase._Option

class Choice(NamedTuple):
    value: str
    label: str
    selected: bool
    render_kw: dict[str, Any]

@dataclass
class SelectChoice:
    value: str
    label: str = ...
    render_kw: dict[str, Any] = ...
    optgroup: str | None = ...
    def __post_init__(self) -> None: ...
    def __iter__(self) -> Iterator[tuple[str, str, dict[str, Any], str | None]]: ...
    @classmethod
    def from_input(
        cls,
        input: SelectChoice | tuple[str, str | None] | tuple[str, str | None, dict[str, Any]] | str,
        optgroup: str | None = None,
    ) -> Self: ...

# we could make these generic, but it's not really worth it
def enum_choices(
    enum_cls: EnumMeta, *, by: Literal["name", "value"] = "value", label: Callable[[Any], str] | None = None
) -> list[SelectChoice]: ...
def enum_coerce(enum_cls: EnumMeta, *, by: Literal["name", "value"] = "value") -> Callable[[Any], Enum]: ...

class SelectFieldBase(Field):
    option_widget: _Widget[_Option]
    def __init__(
        self,
        label: _Text | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        option_widget: _Widget[_Option] | None = None,
        *,
        filters: Sequence[_Filter] = (),
        description: _Text = "",
        id: str | None = None,
        default: object | None = None,
        invalid_value_message: _Text | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...
    def iter_choices(self) -> Iterator[_FullChoice]: ...
    def _iter_choices_normalized(self) -> Iterator[Choice]: ...
    def has_groups(self) -> bool: ...
    def iter_groups(self) -> Iterator[_FullGroupedChoices]: ...
    def _iter_groups_normalized(self) -> Iterator[tuple[str, list[Choice]]]: ...
    def __iter__(self) -> Iterator[_Option]: ...

    class _Option(Field):
        checked: bool

class SelectField(SelectFieldBase):
    coerce: Callable[[Any], Any]
    validate_choice: bool
    invalid_choice_message: _Text

    @overload
    @deprecated("Starting with WTForms 3.4 only SelectChoice will be supported as choices inputs")
    def __init__(
        self,
        label: _Text | None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None,
        coerce: Callable[[Any], Any],
        choices: _LegacyChoices | _LegacyChoicesCallback,
        validate_choice: bool = True,
        invalid_value_message: _Text | None = None,
        invalid_choice_message: _Text | None = None,
        *,
        option_widget: _Widget[_Option] | None = None,
        filters: Sequence[_Filter] = (),
        description: _Text = "",
        id: str | None = None,
        default: object | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...
    @overload
    @deprecated("Starting with WTForms 3.4 only SelectChoice will be supported as choices inputs")
    def __init__(
        self,
        label: _Text | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        coerce: Callable[[Any], Any] = ...,
        *,
        choices: _LegacyChoices | _LegacyChoicesCallback,
        validate_choice: bool = True,
        invalid_value_message: _Text | None = None,
        invalid_choice_message: _Text | None = None,
        option_widget: _Widget[_Option] | None = None,
        filters: Sequence[_Filter] = (),
        description: _Text = "",
        id: str | None = None,
        default: object | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...
    @overload
    def __init__(
        self,
        label: _Text | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        coerce: Callable[[Any], Any] = ...,
        choices: Iterable[SelectChoice] | _SelectChoicesCallback[Self] | None = None,
        validate_choice: bool = True,
        invalid_value_message: _Text | None = None,
        invalid_choice_message: _Text | None = None,
        *,
        option_widget: _Widget[_Option] | None = None,
        filters: Sequence[_Filter] = (),
        description: _Text = "",
        id: str | None = None,
        default: object | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...

    @property
    def choices(self) -> Sequence[_Choice]: ...
    # we would like to have a deprecated overload here as well, but that's not supported
    @choices.setter
    def choices(
        self, value: Iterable[SelectChoice] | _LegacyChoices | _SelectChoicesCallback[Self] | _LegacyChoicesCallback
    ) -> None: ...

class SelectMultipleField(SelectField):
    data: list[Any] | None

class RadioField(SelectField):
    @overload
    @deprecated("Starting with WTForms 3.4 only SelectChoice will be supported as choices inputs")
    def __init__(
        self,
        label: _Text | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        *,
        option_widget: _Widget[_Option] | None = None,
        coerce: Callable[[Any], Any] = ...,
        choices: _LegacyChoices | _LegacyChoicesCallback | None = None,
        validate_choice: bool = True,
        invalid_value_message: _Text | None = None,
        invalid_choice_message: _Text | None = None,
        filters: Sequence[_Filter] = (),
        description: _Text = "",
        id: str | None = None,
        default: object | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...
    @overload
    def __init__(
        self,
        label: _Text | None = None,
        validators: tuple[_Validator[_FormT, Self], ...] | list[Any] | None = None,
        *,
        option_widget: _Widget[_Option] | None = None,
        coerce: Callable[[Any], Any] = ...,
        choices: Iterable[SelectChoice] | _SelectChoicesCallback[Self] | None = None,
        validate_choice: bool = True,
        invalid_value_message: _Text | None = None,
        invalid_choice_message: _Text | None = None,
        filters: Sequence[_Filter] = (),
        description: _Text = "",
        id: str | None = None,
        default: object | None = None,
        widget: _Widget[Self] | None = None,
        render_kw: dict[str, Any] | None = None,
        name: str | None = None,
        datalist: DataList | str | None = None,
        _form: BaseForm | None = None,
        _prefix: str = "",
        _translations: _SupportsGettextAndNgettext | None = None,
        _meta: DefaultMeta | None = None,
    ) -> None: ...
