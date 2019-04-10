# This sample validates the Python 3.7 data class feature, ensuring that
# NamedTuple must be a direct base class.

from typing import NamedTuple

class Parent(NamedTuple):
    pass

class DataTuple2(Parent):
    id: int

data = DataTuple2(id=1)

