import inspect
import os
from _typeshed import Incomplete, SupportsKeysAndGetItem
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import IO, Any, NoReturn, TypeVar
from typing_extensions import Literal, TypedDict

import matplotlib as mpl
from matplotlib.axes import Axes
from matplotlib.figure import Figure, SubFigure
from seaborn._core.data import PlotData
from seaborn._core.moves import Move
from seaborn._core.scales import Scale
from seaborn._core.typing import DataSource, Default, OrderSpec, VariableSpec, VariableSpecList
from seaborn._marks.base import Mark
from seaborn._stats.base import Stat

_ClsT = TypeVar("_ClsT", bound=type[Any])

default: Default

class Layer(TypedDict, total=False):
    mark: Mark
    stat: Stat | None
    move: Move | list[Move] | None
    data: PlotData
    source: DataSource
    vars: dict[str, VariableSpec]
    orient: str
    legend: bool
    label: str | None

class FacetSpec(TypedDict, total=False):
    variables: dict[str, VariableSpec]
    structure: dict[str, list[str]]
    wrap: int | None

class PairSpec(TypedDict, total=False):
    variables: dict[str, VariableSpec]
    structure: dict[str, list[str]]
    cross: bool
    wrap: int | None

@contextmanager
def theme_context(params: dict[str, Any]) -> Generator[None, None, None]: ...
def build_plot_signature(cls: _ClsT) -> _ClsT: ...  # -> _ClsT & "__signature__ protocol"

class ThemeConfig(mpl.RcParams):
    THEME_GROUPS: list[str]
    def __init__(self) -> None: ...
    def reset(self) -> None: ...
    def update(self, __other: SupportsKeysAndGetItem[Incomplete, Incomplete] | None = None, **kwds: Incomplete) -> None: ...  # type: ignore[override]

class DisplayConfig(TypedDict):
    format: Literal["png", "svg"]
    scaling: float
    hidpi: bool

class PlotConfig:
    def __init__(self) -> None: ...
    @property
    def theme(self) -> dict[str, Any]: ...
    @property
    def display(self) -> DisplayConfig: ...

@build_plot_signature
class Plot:
    __signature__: inspect.Signature
    config: PlotConfig
    def __init__(self, *args: DataSource | VariableSpec, data: DataSource = None, **variables: VariableSpec) -> None: ...
    def __add__(self, other) -> NoReturn: ...
    def on(self, target: Axes | SubFigure | Figure) -> Plot: ...
    def add(
        self,
        mark: Mark,
        *transforms: Stat | Move,
        orient: str | None = None,
        legend: bool = True,
        label: str | None = None,
        data: DataSource = None,
        **variables: VariableSpec,
    ) -> Plot: ...
    def pair(
        self, x: VariableSpecList = None, y: VariableSpecList = None, wrap: int | None = None, cross: bool = True
    ) -> Plot: ...
    def facet(
        self,
        col: VariableSpec = None,
        row: VariableSpec = None,
        order: OrderSpec | dict[str, OrderSpec] = None,
        wrap: int | None = None,
    ) -> Plot: ...
    def scale(self, **scales: Scale) -> Plot: ...
    def share(self, **shares: bool | str) -> Plot: ...
    def limit(self, **limits: tuple[Any, Any]) -> Plot: ...
    def label(self, *, title: str | None = None, legend: str | None = None, **variables: str | Callable[[str], str]) -> Plot: ...
    def layout(self, *, size: tuple[float, float] | Default = ..., engine: str | None | Default = ...) -> Plot: ...
    def theme(self, *args: dict[str, Any]) -> Plot: ...
    def save(self, loc: str | os.PathLike[Any] | IO[Any], **kwargs) -> Plot: ...
    def show(self, **kwargs) -> None: ...
    def plot(self, pyplot: bool = False) -> Plotter: ...

class Plotter:
    def __init__(self, pyplot: bool, theme: dict[str, Any]) -> None: ...
    def save(self, loc: str | os.PathLike[Any] | IO[Any], **kwargs) -> Plotter: ...
    def show(self, **kwargs) -> None: ...
