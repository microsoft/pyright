# This sample tests the case where a NamedTuple object is referenced
# through a `self` parameter.

from typing import NamedTuple


class Fruit(NamedTuple):
    name: str
    cost: float

    def new_cost(self, new_cost: float):
        my_name, my_cost = self
        reveal_type(my_name, expected_text="str")
        reveal_type(my_cost, expected_text="float")
        return Fruit(my_name, new_cost)
