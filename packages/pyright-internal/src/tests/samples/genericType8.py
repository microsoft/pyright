# This sample tests that default parameter values can be assigned
# to types that are generic.

from typing import Generic, List, Type, TypeVar


class ClassA:
    pass


T_A = TypeVar("T_A", bound=ClassA)
T = TypeVar("T")


class ClassB(Generic[T_A, T]):
    def __init__(
        self,
        p1: Type[T_A] = ClassA,
        p2: List[T] = [],
        # This should generate an error.
        p3: List[T_A] = [2],
        p4: List[T] = [2],
    ):
        pass
