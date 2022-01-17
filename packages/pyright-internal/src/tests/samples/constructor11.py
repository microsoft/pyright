# This sample tests the case where a subclass of Dict uses
# a dictionary literal as an argument to the constructor call.

from collections import Counter

c1 = Counter({0, 1})
reveal_type(c1, expected_text="Counter[int]")

for i in range(256):
    c1 = Counter({0: c1[1]})
    reveal_type(c1, expected_text="Counter[int]")

reveal_type(c1, expected_text="Counter[int]")
