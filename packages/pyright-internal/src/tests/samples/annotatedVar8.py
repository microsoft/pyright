# This sample tests that incompatible types implicitly assigned
# to an annotated variable via an import statement are flagged
# as an error.

from typing import Callable, Final

# This should generate an error because random is already declared.
import random

random: int = 3

# This should generate an error because os is Final
import os.path

os: Final = 3


# This should generate an error because x is already declared.
from math import pow as x

x: Callable[[], None]

# This should generate an error because pow is already declared.
from math import pow

pow: int = 3

y: Callable[[float, float], float]
from math import pow as y
