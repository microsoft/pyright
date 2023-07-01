# This sample tests the case where a dataclass field has a corresponding
# redundant declaration within a method.

from dataclasses import dataclass


@dataclass
class ClassA:
    a: int
    b: str

    def foo(self):
        self.b: str = ""


ClassA(1, "hi")
