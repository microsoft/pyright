# This sample tests the generation of __init__ when some ancestor
# classes are unknown.

from dataclasses import dataclass
import abc
from random import random

C = abc.ABC if random() else object


class B(C):
    def __init__(self, x: int):
        pass


@dataclass
class A(B):
    color: str


reveal_type(A.__init__, expected_text="(self: A, *args: Any, **kwargs: Any) -> None")
