# This sample tests assignment of dataclass fields that use
# the converter parameter described in PEP 712.

from dataclasses import dataclass, field


def converter_simple(s: str) -> int: ...
def converter_passThru(x: str | int) -> str | int: ...

@dataclass
class Foo:
    # This should generate an error because "converter" is not an official property yet.
    asymmetric: int = field(converter=converter_simple)
    # This should generate an error because "converter" is not an official property yet.
    symmetric: str | int = field(converter=converter_passThru)

foo = Foo("1", 1)

reveal_type(foo.asymmetric, expected_text="int")
foo.asymmetric = "2"
reveal_type(foo.asymmetric, expected_text="int") # Asymmetric -- type narrowing should not occur
# This should generate an error because only strs can be assigned to field0.
foo.asymmetric = 2

reveal_type(foo.symmetric, expected_text="str | int")
foo.symmetric = "1"
reveal_type(foo.symmetric, expected_text="Literal['1']") # Symmetric -- type narrowing should occur


reveal_type(Foo.asymmetric, expected_text="int")
Foo.asymmetric = "2"
reveal_type(Foo.asymmetric, expected_text="int")
# This should generate an error because only strs can be assigned to field0.
Foo.asymmetric = 2

reveal_type(Foo.symmetric, expected_text="str | int")
Foo.symmetric = "1"
reveal_type(Foo.symmetric, expected_text="Literal['1']")