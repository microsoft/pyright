# This sample tests the type checker's type inference logic for
# dictionaries.

from typing import Any, Callable, Literal, Sequence


def wants_int_dict(a: dict[int, int]):
    pass


wants_int_dict({3: 3, 5: 5})
wants_int_dict({x: x for x in [2, 3, 4]})

# This should generate an error because
# the type is wrong.
wants_int_dict({"hello": 3, "bye": 5})

# This should generate an error because
# the type is wrong.
wants_int_dict({"sdf": x for x in [2, 3, 4]})

t1 = ()

# This should generate an error because t1 is not a mapping.
d1 = {**t1}

d2 = {"hi": 3}
d3 = {**d2, "": 4}
reveal_type(d3, expected_text="dict[str, int]")


LitChoices = Literal["ab", "bcd"]

keys: list[LitChoices] = ["ab", "bcd"]
d4: dict[LitChoices, int] = {k: len(k) for k in keys}


d5: dict[str, Callable[[Sequence[Any]], float]] = {
    "min": min,
    "max": max,
    "sum": sum,
}

LiteralDict = dict[LitChoices, str]

d6: LiteralDict = {"ab": "x"}
d7: LiteralDict = {"bcd": "y"}
d6 = {**d6, **d7}
d6 = d6 | d7


def func1(args):
    d1 = {**args, "x": 123}
    reveal_type(d1, expected_text="dict[Unknown, Unknown]")


#
