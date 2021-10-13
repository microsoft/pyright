# This sample tests the case where a NamedTuple object is referenced
# through a `self` parameter.

from typing import Literal, NamedTuple


class Fruit(NamedTuple):
    name: str
    cost: float

    def new_cost(self, new_cost: float):
        my_name, my_cost = self
        t1: Literal["str"] = reveal_type(my_name)
        t2: Literal["float"] = reveal_type(my_cost)
        return Fruit(my_name, new_cost)
