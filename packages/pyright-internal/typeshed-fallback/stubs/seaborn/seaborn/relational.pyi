from _typeshed import Incomplete
from collections.abc import Iterable
from typing import Any
from typing_extensions import Literal, TypeAlias

from matplotlib.axes import Axes
from matplotlib.colors import Colormap

from .axisgrid import FacetGrid
from .utils import _ErrorBar, _Estimator, _Legend, _Palette, _Seed

__all__ = ["relplot", "scatterplot", "lineplot"]

_Sizes: TypeAlias = list[float] | dict[str, float] | tuple[float, float]

def lineplot(
    data: Incomplete | None = None,
    *,
    x: Incomplete | None = None,
    y: Incomplete | None = None,
    hue: Incomplete | None = None,
    size: Incomplete | None = None,
    style: Incomplete | None = None,
    units: Incomplete | None = None,
    palette: _Palette | Colormap | None = None,
    hue_order: Iterable[Any] | None = None,
    hue_norm: Incomplete | None = None,
    sizes: _Sizes | None = None,
    size_order: Iterable[Any] | None = None,
    size_norm: Incomplete | None = None,
    dashes: bool | list[Incomplete] | dict[str, Incomplete] = True,
    markers: Incomplete | None = None,
    style_order: Iterable[Any] | None = None,
    estimator: _Estimator | None = "mean",
    errorbar: _ErrorBar | None = ("ci", 95),
    n_boot: int = 1000,
    seed: _Seed | None = None,
    orient: Literal["x", "y"] = "x",
    sort: bool = True,
    err_style: Literal["band", "bars"] = "band",
    err_kws: dict[str, Any] | None = None,
    legend: _Legend = "auto",
    ci: str | int | None = "deprecated",  # deprecated
    ax: Axes | None = None,
    **kwargs: Any,
) -> Axes: ...
def scatterplot(
    data: Incomplete | None = None,
    *,
    x: Incomplete | None = None,
    y: Incomplete | None = None,
    hue: Incomplete | None = None,
    size: Incomplete | None = None,
    style: Incomplete | None = None,
    palette: _Palette | Colormap | None = None,
    hue_order: Iterable[Any] | None = None,
    hue_norm: Incomplete | None = None,
    sizes: _Sizes | None = None,
    size_order: Iterable[Any] | None = None,
    size_norm: Incomplete | None = None,
    markers: Incomplete = True,
    style_order: Iterable[Any] | None = None,
    legend: _Legend = "auto",
    ax: Axes | None = None,
    **kwargs: Any,
) -> Axes: ...
def relplot(
    data: Incomplete | None = None,
    *,
    x: Incomplete | None = None,
    y: Incomplete | None = None,
    hue: Incomplete | None = None,
    size: Incomplete | None = None,
    style: Incomplete | None = None,
    units: Incomplete | None = None,
    row: Incomplete | None = None,
    col: Incomplete | None = None,
    col_wrap: int | None = None,
    row_order: Iterable[Any] | None = None,
    col_order: Iterable[Any] | None = None,
    palette: _Palette | Colormap | None = None,
    hue_order: Iterable[Any] | None = None,
    hue_norm: Incomplete | None = None,
    sizes: _Sizes | None = None,
    size_order: Iterable[Any] | None = None,
    size_norm: Incomplete | None = None,
    markers: Incomplete | None = None,
    dashes: Incomplete | None = None,
    style_order: Iterable[Any] | None = None,
    legend: _Legend = "auto",
    kind: Literal["scatter", "line"] = "scatter",
    height: float = 5,
    aspect: float = 1,
    facet_kws: dict[str, Any] | None = None,
    **kwargs: Any,
) -> FacetGrid: ...
