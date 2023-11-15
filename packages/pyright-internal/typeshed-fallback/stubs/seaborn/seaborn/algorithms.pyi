from collections.abc import Callable
from typing import Any

from numpy.typing import ArrayLike, NDArray

from .utils import _Seed

def bootstrap(
    *args: ArrayLike,
    n_boot: int = 10000,
    func: str | Callable[..., Any] = "mean",
    axis: int | None = None,
    units: ArrayLike | None = None,
    seed: _Seed | None = None,
    random_seed: _Seed | None = None,  # deprecated
) -> NDArray[Any]: ...
