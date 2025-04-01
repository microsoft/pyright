# This sample tests the case where a type alias is used in a class
# declaration. We want to ensure that the variance of type variables
# is compatible with the usage within the type alias.

from typing import Generic, TypeVar, TypeAlias

T1 = TypeVar("T1")
T2 = TypeVar("T2", covariant=True)
T3 = TypeVar("T3", contravariant=True)


class A(Generic[T1]):
    pass


A_Alias_1: TypeAlias = A[T2]

A_Alias_2: TypeAlias = A_Alias_1[T2 | int]


# This should generate an error because the variance is incompatible.
class A_1(A_Alias_1[T2]): ...


# This should generate an error because the variance is incompatible.
class A_2(A_Alias_2[T2]): ...


# This should generate an error because the variance is incompatible.
class A_3(A[T2]): ...


class B(Generic[T1, T2]):
    pass


B_Alias_1 = B[T2, T3]


# This should generate an error because the variance is incompatible.
class C(B_Alias_1[T3, T2]): ...
