from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from enum import EnumMeta
from typing import Any, Protocol, TypeAlias, type_check_only
from typing_extensions import Self

from markupsafe import Markup
from wtforms.fields import Field

_RawDataListChoice: TypeAlias = str | tuple[str] | tuple[str, str | None] | tuple[str, str | None, dict[str, Any]]
_DataListChoices: TypeAlias = Sequence[DataListChoice | _RawDataListChoice] | dict[str, str]

@type_check_only
class _DataListWidget(Protocol):
    # see the comment on `wtforms.widgets.core._RenderArg` for a thorough explanation of the kwargs
    def __call__(self, datalist: DataList, /, *, field: Field | None = None, **kwargs: Any) -> Markup: ...

__all__ = ("DataList", "DataListChoice", "enum_datalist")

@dataclass
class DataListChoice:
    value: str
    label: str | None = ...
    render_kw: dict[str, Any] = ...
    def __post_init__(self) -> None: ...
    def __iter__(self) -> Iterator[tuple[str, str, dict[str, Any]]]: ...
    @classmethod
    def from_input(cls, input: DataListChoice | _RawDataListChoice) -> Self: ...

def enum_datalist(enum_cls: EnumMeta, *, by: str = "value", label: str | None = None) -> DataList: ...

class DataList:
    widget: _DataListWidget
    render_kw: dict[str, Any]
    id: str | None
    def __init__(
        self,
        choices: _DataListChoices | Callable[[Any, Any], _DataListChoices] | Callable[[], _DataListChoices] | None = None,
        *,
        render_kw: dict[str, Any] | None = None,
        widget: _DataListWidget | None = None,
    ) -> None: ...
    def iter_choices(self, field: Field | None = None) -> list[DataListChoice]: ...
    # by default this invokes the bound `widget.__call__` with the given kwargs and bound `render_kw`
    # see the comment on `wtforms.widgets.core._RenderArg` for a thorough explanation
    def __call__(self, field: Field | None = None, **kwargs: Any) -> Markup: ...
