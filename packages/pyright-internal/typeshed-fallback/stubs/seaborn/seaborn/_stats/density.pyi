from collections.abc import Callable
from dataclasses import dataclass

from seaborn._stats.base import Stat
from seaborn.external.kde import gaussian_kde

@dataclass
class KDE(Stat):
    bw_adjust: float = 1
    bw_method: str | float | Callable[[gaussian_kde], float] = "scott"
    common_norm: bool | list[str] = True
    common_grid: bool | list[str] = True
    gridsize: int | None = 200
    cut: float = 3
    cumulative: bool = False
    def __post_init__(self) -> None: ...
