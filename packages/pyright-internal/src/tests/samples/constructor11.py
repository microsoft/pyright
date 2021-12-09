# This sample tests the case where a subclass of Dict uses
# a dictionary literal as an argument to the constructor call.

from collections import Counter
from typing import Literal

c1 = Counter({0, 1})
t1: Literal["Counter[int]"] = reveal_type(c1)

for i in range(256):
    c1 = Counter({0: c1[1]})
    t2: Literal["Counter[int]"] = reveal_type(c1)

t3: Literal["Counter[int]"] = reveal_type(c1)
