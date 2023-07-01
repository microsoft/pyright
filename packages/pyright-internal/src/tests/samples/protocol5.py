# This sample is taken from PEP 544. It verifies that
# the type checker allows instance variables that are initialized
# in a method to be counted toward conformance to a defined Protocol.

from typing import Protocol


class Template(Protocol):
    name: str  # This is a protocol member
    value: int = 0  # This one too (with default)

    def method(self) -> None:
        pass


class Concrete:
    def __init__(self, name: str, value: int) -> None:
        self.name = name
        self.value = value

    def method(self) -> None:
        return


var: Template = Concrete("value", 42)
