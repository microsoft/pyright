# This sample tests assignment of a function that uses
# a synthesized TypeVar type for the "self" parameter.

from typing import Callable


class TestClass:
    def method(self) -> None:
        pass


func1: Callable[[float], None] = TestClass.method

