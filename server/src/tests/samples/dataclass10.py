# This sample tests the case where a dataclass entry is
# initialized with a "field" that uses "init=False". This
# case needs to be handled specially because it means
# that the synthesized __init__ method shouldn't include
# this field in its parameter list.

from dataclasses import dataclass, field


@dataclass
class Parent:
    prop_one: str = field(init=False)

    def __post_init__(self):
        self.prop_one = "test"


@dataclass
class Child(Parent):
    prop_two: str


test = Child(prop_two="test")

assert test.prop_one == "test"
assert test.prop_two == "test"

