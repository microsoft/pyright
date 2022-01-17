# This sample tests the use of the InitVar annotation.

from dataclasses import InitVar as InitVarAlias

from dataclasses import *


@dataclass
class Container:
    init_var1: InitVarAlias[int]
    init_var2: InitVar[int]

    not_init_var1: int


c = Container(1, 2, 3)
reveal_type(c.not_init_var1, expected_text="int")

# This should generate an error
c.init_var1

# This should generate an error
c.init_var2
