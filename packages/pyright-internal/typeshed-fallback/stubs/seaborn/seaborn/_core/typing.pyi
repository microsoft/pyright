from _typeshed import Incomplete
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Any
from typing_extensions import TypeAlias

from matplotlib.colors import Colormap, Normalize
from numpy import ndarray
from pandas import Index, Series, Timedelta, Timestamp

ColumnName: TypeAlias = str | bytes | date | datetime | timedelta | bool | complex | Timestamp | Timedelta
Vector: TypeAlias = Series[Any] | Index[Any] | ndarray[Any, Any]
VariableSpec: TypeAlias = ColumnName | Vector | None
VariableSpecList: TypeAlias = list[VariableSpec] | Index[Any] | None
DataSource: TypeAlias = Incomplete
OrderSpec: TypeAlias = Iterable[str] | None
NormSpec: TypeAlias = tuple[float | None, float | None] | Normalize | None
PaletteSpec: TypeAlias = str | list[Incomplete] | dict[Incomplete, Incomplete] | Colormap | None
DiscreteValueSpec: TypeAlias = dict[Incomplete, Incomplete] | list[Incomplete] | None
ContinuousValueSpec: TypeAlias = tuple[float, float] | list[float] | dict[Any, float] | None

class Default: ...
class Deprecated: ...

default: Default
deprecated: Deprecated
