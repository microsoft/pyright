# This sample validates the Python 3.7 data class feature, ensuring that
# NamedTuple must be a direct base class.

from typing import NamedTuple


class Parent(NamedTuple):
    pass


class DataTuple2(Parent):
    id: int


# This should generate an error because DataTuple2 isn't considered
# a data class and won't have the associated __new__ or __init__
# method defined.
data = DataTuple2(id=1)
