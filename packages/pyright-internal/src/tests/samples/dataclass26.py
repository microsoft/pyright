# This sample tests assignment of dataclass fields that use
# the coverter parameter described in PEP 712.

from dataclasses import dataclass, field


def converter_simple(s: str) -> int:
    return int(s)


@dataclass
class Foo:
    # This should generate an error because "converter" is not an official property yet.
    field0: int = field(converter=converter_simple)

foo = Foo("1")
reveal_type(foo.field0, expected_text="int")
foo.field0 = "2"

# This should generate an error because only strs can be assigned to field0.
foo.field0 = 2
