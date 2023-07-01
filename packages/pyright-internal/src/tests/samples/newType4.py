# This sample tests some error conditions for NewType usage.

from typing import Literal, NewType, Sized, Union


# This should generate an error.
A = NewType("A", Union[int, str])

# This should generate an error.
B = NewType("B", Literal[1])

# This should generate an error.
C = NewType("B", Sized)

# This should generate an error.
D = NewType("A", int | str)
