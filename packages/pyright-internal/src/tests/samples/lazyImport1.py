# This sample tests the parsing of lazy import statements (PEP 810).

# This should parse cleanly at Python 3.15.
lazy import json

# This should parse cleanly at Python 3.15.
lazy from json import loads

# "lazy" used as an identifier should always work.
lazy = 1

# "lazy" used as a parameter name should always work.
def f(lazy: int) -> int:
    return lazy

# "lazy" used as an attribute should always work.
class C:
    lazy = True
