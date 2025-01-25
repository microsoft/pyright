# This sample tests certain error conditions that previously caused
# an infinite recursion condition in the type evaluator.

from __future__ import annotations
from enum import Enum
from typing import Literal


class A(Enum):
    # This should generate two errors.
    x: Literal[A.x]


class B(Enum):
    # This should generate an error.
    x: B.x
