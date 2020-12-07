# This sample tests assignment when the types are invariant and the
# destination is a union that contains subtypes which are subclasses
# of each other.

from datetime import datetime
from typing import List, Union


class FloatSubclass(float):
    pass


float_list: List[float] = [1.0, 2.0]

v1: List[Union[float, FloatSubclass]] = float_list

v2: List[Union[int, float]] = float_list

# This should generate an error.
v3: List[Union[int, float, datetime]] = float_list
