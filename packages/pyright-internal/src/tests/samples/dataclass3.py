# This sample tests the type checker's handling of
# synthesized __init__ and __new__ methods for
# dataclass classes and their subclasses.

from dataclasses import dataclass


@dataclass
class A:
    x: int


@dataclass(init=False)
class B(A):
    y: int

    def __init__(self, a: A, y: int):
        self.__dict__ = a.__dict__


a = A(3)
b = B(a, 5)


# This should generate an error because there is an extra parameter
a = A(3, 4)

# This should generate an error because there is one too few parameters
b = B(a)


A.__new__(A)
B.__new__(B)
