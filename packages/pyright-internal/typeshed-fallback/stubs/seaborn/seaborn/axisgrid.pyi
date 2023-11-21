from _typeshed import Incomplete
from collections.abc import Callable, Generator, Iterable, Mapping
from typing import Any, TypeVar
from typing_extensions import Concatenate, Literal, ParamSpec, Self

from matplotlib.artist import Artist
from matplotlib.axes import Axes
from matplotlib.colors import Colormap
from matplotlib.figure import Figure
from matplotlib.legend import Legend
from matplotlib.text import Text
from matplotlib.typing import ColorType
from numpy.typing import NDArray
from pandas import DataFrame, Series

from .palettes import _RGBColorPalette
from .utils import _Palette

__all__ = ["FacetGrid", "PairGrid", "JointGrid", "pairplot", "jointplot"]

_P = ParamSpec("_P")
_R = TypeVar("_R")

class _BaseGrid:
    def set(self, **kwargs: Incomplete) -> Self: ...  # **kwargs are passed to `matplotlib.axes.Axes.set`
    @property
    def fig(self) -> Figure: ...
    @property
    def figure(self) -> Figure: ...
    def apply(self, func: Callable[Concatenate[Self, _P], object], *args: _P.args, **kwargs: _P.kwargs) -> Self: ...
    def pipe(self, func: Callable[Concatenate[Self, _P], _R], *args: _P.args, **kwargs: _P.kwargs) -> _R: ...
    def savefig(
        self, *args: Incomplete, **kwargs: Incomplete
    ) -> None: ...  # *args and **kwargs are passed to `matplotlib.figure.Figure.savefig`

class Grid(_BaseGrid):
    def __init__(self) -> None: ...
    def tight_layout(
        self, *args: Incomplete, **kwargs: Incomplete
    ) -> Self: ...  # *args and **kwargs are passed to `matplotlib.figure.Figure.tight_layout`
    def add_legend(
        self,
        legend_data: Mapping[Any, Artist] | None = None,  # cannot use precise key type because of invariant Mapping keys
        title: str | None = None,
        label_order: list[str] | None = None,
        adjust_subtitles: bool = False,
        **kwargs: Incomplete,  # **kwargs are passed to `matplotlib.figure.Figure.legend`
    ) -> Self: ...
    @property
    def legend(self) -> Legend | None: ...
    def tick_params(
        self, axis: Literal["x", "y", "both"] = "both", **kwargs: Incomplete
    ) -> Self: ...  # **kwargs are passed to `matplotlib.axes.Axes.tick_params`

class FacetGrid(Grid):
    data: DataFrame
    row_names: list[Any]
    col_names: list[Any]
    hue_names: list[Any] | None
    hue_kws: dict[str, Any]
    def __init__(
        self,
        data: DataFrame,
        *,
        row: str | None = None,
        col: str | None = None,
        hue: str | None = None,
        col_wrap: int | None = None,
        sharex: bool | Literal["col", "row"] = True,
        sharey: bool | Literal["col", "row"] = True,
        height: float = 3,
        aspect: float = 1,
        palette: _Palette | None = None,
        row_order: Iterable[Any] | None = None,
        col_order: Iterable[Any] | None = None,
        hue_order: Iterable[Any] | None = None,
        hue_kws: dict[str, Any] | None = None,
        dropna: bool = False,
        legend_out: bool = True,
        despine: bool = True,
        margin_titles: bool = False,
        xlim: tuple[float, float] | None = None,
        ylim: tuple[float, float] | None = None,
        subplot_kws: dict[str, Any] | None = None,
        gridspec_kws: dict[str, Any] | None = None,
    ) -> None: ...
    def facet_data(self) -> Generator[tuple[tuple[int, int, int], DataFrame], None, None]: ...
    def map(self, func: Callable[..., object], *args: str, **kwargs: Any) -> Self: ...
    def map_dataframe(self, func: Callable[..., object], *args: str, **kwargs: Any) -> Self: ...
    def facet_axis(self, row_i: int, col_j: int, modify_state: bool = True) -> Axes: ...
    def despine(
        self,
        *,
        fig: Figure | None = None,
        ax: Axes | None = None,
        top: bool = True,
        right: bool = True,
        left: bool = False,
        bottom: bool = False,
        offset: int | Mapping[str, int] | None = None,
        trim: bool = False,
    ) -> Self: ...
    def set_axis_labels(
        self, x_var: str | None = None, y_var: str | None = None, clear_inner: bool = True, **kwargs: Any
    ) -> Self: ...
    def set_xlabels(self, label: str | None = None, clear_inner: bool = True, **kwargs: Any) -> Self: ...
    def set_ylabels(self, label: str | None = None, clear_inner: bool = True, **kwargs: Any) -> Self: ...
    def set_xticklabels(self, labels: Iterable[str | Text] | None = None, step: int | None = None, **kwargs: Any) -> Self: ...
    def set_yticklabels(self, labels: Iterable[str | Text] | None = None, **kwargs: Any) -> Self: ...
    def set_titles(
        self, template: str | None = None, row_template: str | None = None, col_template: str | None = None, **kwargs: Any
    ) -> Self: ...
    def refline(
        self, *, x: float | None = None, y: float | None = None, color: ColorType = ".5", linestyle: str = "--", **line_kws: Any
    ) -> Self: ...
    @property
    def axes(self) -> NDArray[Incomplete]: ...  # array of `Axes`
    @property
    def ax(self) -> Axes: ...
    @property
    def axes_dict(self) -> dict[Any, Axes]: ...

class PairGrid(Grid):
    x_vars: list[str]
    y_vars: list[str]
    square_grid: bool
    axes: NDArray[Incomplete]  # two-dimensional array of `Axes`
    data: DataFrame
    diag_sharey: bool
    diag_vars: NDArray[Incomplete] | None  # array of `str`
    diag_axes: NDArray[Incomplete] | None  # array of `Axes`
    hue_names: list[str]
    hue_vals: Series[Incomplete]
    hue_kws: dict[str, Any]
    palette: _RGBColorPalette
    def __init__(
        self,
        data: DataFrame,
        *,
        hue: str | None = None,
        vars: Iterable[str] | None = None,
        x_vars: Iterable[str] | str | None = None,
        y_vars: Iterable[str] | str | None = None,
        hue_order: Iterable[str] | None = None,
        palette: _Palette | None = None,
        hue_kws: dict[str, Any] | None = None,
        corner: bool = False,
        diag_sharey: bool = True,
        height: float = 2.5,
        aspect: float = 1,
        layout_pad: float = 0.5,
        despine: bool = True,
        dropna: bool = False,
    ) -> None: ...
    def map(self, func: Callable[..., object], **kwargs: Any) -> Self: ...
    def map_lower(self, func: Callable[..., object], **kwargs: Any) -> Self: ...
    def map_upper(self, func: Callable[..., object], **kwargs: Any) -> Self: ...
    def map_offdiag(self, func: Callable[..., object], **kwargs: Any) -> Self: ...
    def map_diag(self, func: Callable[..., object], **kwargs: Any) -> Self: ...

class JointGrid(_BaseGrid):
    ax_joint: Axes
    ax_marg_x: Axes
    ax_marg_y: Axes
    x: Series[Incomplete]
    y: Series[Incomplete]
    hue: Series[Incomplete]
    def __init__(
        self,
        data: Incomplete | None = None,
        *,
        x: Incomplete | None = None,
        y: Incomplete | None = None,
        hue: Incomplete | None = None,
        height: float = 6,
        ratio: float = 5,
        space: float = 0.2,
        palette: _Palette | Colormap | None = None,
        hue_order: Iterable[str] | None = None,
        hue_norm: Incomplete | None = None,
        dropna: bool = False,
        xlim: Incomplete | None = None,
        ylim: Incomplete | None = None,
        marginal_ticks: bool = False,
    ) -> None: ...
    def plot(self, joint_func: Callable[..., object], marginal_func: Callable[..., object], **kwargs: Any) -> Self: ...
    def plot_joint(self, func: Callable[..., object], **kwargs: Any) -> Self: ...
    def plot_marginals(self, func: Callable[..., object], **kwargs: Any) -> Self: ...
    def refline(
        self,
        *,
        x: float | None = None,
        y: float | None = None,
        joint: bool = True,
        marginal: bool = True,
        color: ColorType = ".5",
        linestyle: str = "--",
        **line_kws: Any,
    ) -> Self: ...
    def set_axis_labels(self, xlabel: str = "", ylabel: str = "", **kwargs: Any) -> Self: ...

def pairplot(
    data: DataFrame,
    *,
    hue: str | None = None,
    hue_order: Iterable[str] | None = None,
    palette: _Palette | None = None,
    vars: Iterable[str] | None = None,
    x_vars: Iterable[str] | str | None = None,
    y_vars: Iterable[str] | str | None = None,
    kind: Literal["scatter", "kde", "hist", "reg"] = "scatter",
    diag_kind: Literal["auto", "hist", "kde"] | None = "auto",
    markers: Incomplete | None = None,
    height: float = 2.5,
    aspect: float = 1,
    corner: bool = False,
    dropna: bool = False,
    plot_kws: dict[str, Any] | None = None,
    diag_kws: dict[str, Any] | None = None,
    grid_kws: dict[str, Any] | None = None,
    size: float | None = None,  # deprecated
) -> PairGrid: ...
def jointplot(
    data: Incomplete | None = None,
    *,
    x: Incomplete | None = None,
    y: Incomplete | None = None,
    hue: Incomplete | None = None,
    kind: str = "scatter",  # ideally Literal["scatter", "kde", "hist", "hex", "reg", "resid"] but it is checked with startswith
    height: float = 6,
    ratio: float = 5,
    space: float = 0.2,
    dropna: bool = False,
    xlim: Incomplete | None = None,
    ylim: Incomplete | None = None,
    color: ColorType | None = None,
    palette: _Palette | Colormap | None = None,
    hue_order: Iterable[str] | None = None,
    hue_norm: Incomplete | None = None,
    marginal_ticks: bool = False,
    joint_kws: dict[str, Any] | None = None,
    marginal_kws: dict[str, Any] | None = None,
    **kwargs: Any,
) -> JointGrid: ...
