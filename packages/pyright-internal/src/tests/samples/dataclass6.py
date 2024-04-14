# This sample tests the case where a dataclass entry is
# initialized with a "field" that uses "init=False". This
# case needs to be handled specially because it means
# that the synthesized __init__ method shouldn't include
# this field in its parameter list.

from dataclasses import dataclass, field


@dataclass
class ParentA:
    prop_1: str = field(init=False)
    prop_2: str = field(default="hello")
    prop_3: str = field(default_factory=lambda: "hello")

    # This should generate an error because it appears after
    # a property with a default value.
    prop_4: str = field()

    def __post_init__(self):
        self.prop_1 = "test"


@dataclass
class ChildA(ParentA):
    prop_2: str = "bye"


test = ChildA(prop_2="test", prop_4="hi")

assert test.prop_1 == "test"
assert test.prop_2 == "test"


@dataclass
class ClassB:
    prop_1: str
    prop_2: str
    prop_3: str = field(default="")
    prop_4: str = field(init=False)
    prop_5: str = field(init=False)

    def __post_init__(self):
        cprop_1 = "calculated value"
        cprop_2 = "calculated value"
