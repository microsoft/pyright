# This sample tests the case where a constrained type variable
# includes a Literal[False] and Literal[True].

from typing import TypeVar, Generic, Literal

XOrY = TypeVar("XOrY", Literal[True], Literal[False])


class A(Generic[XOrY]):
    pass


class B(Generic[XOrY]):
    def __init__(self, a: A[XOrY]):
        self.a = a
