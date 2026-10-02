from typing import assert_type

import numpy as np
import numpy.typing as npt

inner = np.array([1, 2], dtype=np.float64)
assert_type(np.array(inner), npt.NDArray[np.float64])
assert_type(np.array([inner, inner]), npt.NDArray[np.float64])
assert_type(np.array([[inner], [inner]]), npt.NDArray[np.float64])
assert_type(np.array([[1, 2], [3, 4]], dtype=np.float64), npt.NDArray[np.float64])


def accepts_float_array(value: npt.NDArray[np.float64]) -> None:
    pass


accepts_float_array(np.array([1, 2], dtype=np.int64))