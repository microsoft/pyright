# This sample is used in conjunction with import13.py to test
# PEP 562 (module-level __getattr__) support.

# pyright: strict

from typing import Literal
from .import13 import foo1
from . import import13

t1: Literal["int"] = reveal_type(foo1)
t2: Literal["int"] = reveal_type(import13.foo2)
