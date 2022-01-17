# This sample tests the type checker's type inference logic for
# dictionaries.

from typing import Dict, List, Literal


def wantsIntDict(a: Dict[int, int]):
    pass


wantsIntDict({3: 3, 5: 5})
wantsIntDict({x: x for x in [2, 3, 4]})

# This should generate an error because
# the type is wrong.
wantsIntDict({"hello": 3, "bye": 5})

# This should generate an error because
# the type is wrong.
wantsIntDict({"sdf": x for x in [2, 3, 4]})

t1 = ()

# This should generate an error because t1 is not a mapping.
d1 = {**t1}

d2 = {"hi": 3}
d3 = {**d2, "": 4}
reveal_type(d3, expected_text="dict[str, int]")


LitChoices = Literal["ab", "bcd"]

keys: List[LitChoices] = ["ab", "bcd"]
d1: Dict[LitChoices, int] = {k: len(k) for k in keys}
