# This sample tests the interactions between traditional TypeVars and
# PEP 695 type parameter syntax.

from typing import Generic, TypeVar


T1 = TypeVar("T1")
T2 = TypeVar("T2")
T4 = TypeVar("T4")


# This should generate an error because traditional type variables
# like T1 cannot be combined with new-style type parameters.
class ClassA[T3](dict[T1, T3]): ...


class ClassB(Generic[T1]):
    class ClassC[T2](dict[T1, T2]):
        def method1[T3](self, a: T1, b: T2, c: T3) -> T1 | T2 | T3: ...

        # This should generate an error because traditional type variables
        # like T4 cannot be combined with new-style type parameters.
        def method2[T3](self, a: T3, b: T4) -> T3 | T4: ...
