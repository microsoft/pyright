# This sample tests the handling of a __getattr__ method that returns
# a callable. Such a method should not be bound.

from typing import Callable


class ClassA:
    def __init__(self):
        return

    def __getattr__(self) -> Callable[[str], str]:
        return lambda a: a


a = ClassA()

a.foo("hi")
