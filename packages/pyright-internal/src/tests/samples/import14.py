# This sample is used in conjunction with import13.py to test
# PEP 562 (module-level __getattr__) support.

# pyright: strict

from .import13 import foo1
from . import import13

reveal_type(foo1, expected_text="int")
reveal_type(import13.foo2, expected_text="int")
