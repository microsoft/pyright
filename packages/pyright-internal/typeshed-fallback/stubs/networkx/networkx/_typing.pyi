# Stub-only module, can't be imported at runtime.

from typing import TypeVar
from typing_extensions import TypeAlias

import numpy as np

_G = TypeVar("_G", bound=np.generic)

# numpy aliases
Array1D: TypeAlias = np.ndarray[tuple[int], np.dtype[_G]]
Array2D: TypeAlias = np.ndarray[tuple[int, int], np.dtype[_G]]
Seed: TypeAlias = int | np.random.Generator | np.random.RandomState
