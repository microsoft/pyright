# This sample tests a case that previously resulted in infinite recursion.

from typing import TypeVar, Generic

U = TypeVar("U")
T = TypeVar("T")


class A(Generic[T]):
    pass


class B(Generic[T]):
    pass


class C(Generic[T]):
    pass


TA1 = A["TA2[U]"] | B["TA2[U]"]
TA2 = TA1[U] | C[TA1[U]]
TA3 = TA2[U]
