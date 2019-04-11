# This sample tests the handling of the @dataclass decorator.

from dataclasses import dataclass

@dataclass
class Bar():
    foo: int

    # This should generate an error because names
    # beginning with an underscore are not allowed
    # in data classes.
    _foo: int

bar = Bar(foo=5)
bar2 = Bar(5)

# This should generate an error because bar
# isn't a declared value.
bar = Bar(foo=5, bar=5)
