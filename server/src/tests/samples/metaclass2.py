# This sample verifies that the type checker allows access
# to class variables provided by a metaclass.

from enum import Enum
from typing import Mapping


class Fruit(Enum):
    apple = 1
    orange = 2
    pear = 3


def requires_fruit_mapping(a: Mapping[str, Fruit]):
    pass


requires_fruit_mapping(Fruit.__members__)

aaa = len(Fruit)

for i in Fruit:
    print(i)

