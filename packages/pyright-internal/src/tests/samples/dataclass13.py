# This sample tests that a dataclass member without a type annotation
# but with a field descriptor assignment results in an error.

from dataclasses import dataclass, field


@dataclass
class MyClass:
    id: int
    x: int = field()

    # This should generate an error because it will result in a runtime exception
    y = field()
