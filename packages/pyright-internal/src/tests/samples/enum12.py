# This sample tests that any attribute that is treated as a member at
# runtime does not have a type annotation. The typing spec indicates that
# type checkers should flag such conditions as errors.

from enum import Enum
from typing import Callable


class Enum1(Enum):
    # This should generate an error.
    MEMBER: int = 1

    _NON_MEMBER_: int = 3

    NON_MEMBER_CALLABLE: Callable[[], int] = lambda: 1
