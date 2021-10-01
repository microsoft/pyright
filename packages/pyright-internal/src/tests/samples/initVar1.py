# This sample tests the use of the InitVar annotation.

from dataclasses import InitVar as InitVarAlias

from dataclasses import *
from typing import Literal


@dataclass
class Container:
    init_var1: InitVarAlias[int]
    init_var2: InitVar[int]

    not_init_var1: int


c = Container(1, 2, 3)
t1: Literal["int"] = reveal_type(c.not_init_var1)

# This should generate an error
c.init_var1

# This should generate an error
c.init_var2
