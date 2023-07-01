# This sample tests the "Final" type annotation
# introduced in Python 3.8.

from typing import Final

class ClassA:
    foo1: Final[int]
    def __init__(self):
        self.foo2: Final[str]
    def other(self):
        # This should generate an error because Final is
        # not allowed in methods other than __init__.
        self.foo3: Final[str]

# This should generate an error because Final isn't allowed in
# parameter annotations.
def func1(a: Final[str]) -> None: ...

# This should generate an error because Final isn't allowed in
# return type annotations.
def func2() -> Final[str]: ...
