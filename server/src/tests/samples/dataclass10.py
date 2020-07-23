# This sample tests the case where a dataclass entry is
# initialized with a "field" that uses "init=False". This
# case needs to be handled specially because it means
# that the synthesized __init__ method shouldn't include
# this field in its parameter list.

from dataclasses import dataclass, field


@dataclass
class Parent:
    prop_1: str = field(init=False)
    prop_2: str = field(default="hello")
    prop_3: str = field(default_factory=lambda: "hello")

    # This should generate an error because it appears after
    # a property with a default value.
    prop_4: str = field()

    def __post_init__(self):
        self.prop_1 = "test"


@dataclass
class Child(Parent):
    prop_2: str


test = Child(prop_2="test", prop_4="hi")

assert test.prop_1 == "test"
assert test.prop_2 == "test"


@dataclass
class HandshakeMessage:
    reset_reason_hex: str
    reset_data_hex: str
    device_id: str = field(default="")
    reset_reason: str = field(init=False)
    reset_data: str = field(init=False)

    def __post_init__(self):
        reset_reason = "calculated value"
        reset_data = "calculated value"
