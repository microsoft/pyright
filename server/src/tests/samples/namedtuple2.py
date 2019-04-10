# This sample validates the Python 3.7 data class feature, ensuring that
# fields starting with '_' are flagged as errors.

from typing import NamedTuple

class DataTuple2(NamedTuple):
    _id: int
