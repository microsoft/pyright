# This sample tests some error conditions for NewType usage.

from typing import NewType


A = NewType("A", Union[int, str])
B = NewType("B", Literal[1])
C = NewType("B", Sized)
