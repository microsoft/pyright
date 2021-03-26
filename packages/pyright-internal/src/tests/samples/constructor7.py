# This sample tests the case where a __new__ method provides
# a type that differs from the class that contains it.

from typing import Literal


class HelloWorld:
    def __new__(cls) -> str:
        return "Hello World"


v1 = HelloWorld()
t_v1: Literal["str"] = reveal_type(v1)
