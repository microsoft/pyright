# This sample tests the callable syntax described in PEP 677. Specifically,
# it tests that an error is generated when not using Python 3.11.

from typing import TypeAlias


# This should generate an error when using versions of Python prior to 3.11.
A1 = (int) -> int

A2: TypeAlias = "(int) -> int"

def func1(a: "(int) -> (() -> None)") -> "(...) -> int":
    ...

# This should generate an error when using versions of Python prior to 3.11.
def func2(a: (int) -> int) -> int:
    ...
   