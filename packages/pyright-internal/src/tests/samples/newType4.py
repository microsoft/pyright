# This sample tests some error conditions for NewType usage.

from typing import Literal, NewType, Sized, Union


A = NewType("A", Union[int, str])
B = NewType("B", Literal[1])
C = NewType("B", Sized)
