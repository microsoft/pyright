# This sample tests the case where a class uses auto-variance but derives
# from a class that does not.

from typing import Generic, TypeVar

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)
T_contra = TypeVar("T_contra", contravariant=True)


class Parent_Invariant(Generic[T]):
    pass


class ShouldBeInvariant[T](Parent_Invariant[T]):
    pass


# This should generate an error.
a1: ShouldBeInvariant[int] = ShouldBeInvariant[float]()

# This should generate an error.
a2: ShouldBeInvariant[float] = ShouldBeInvariant[int]()


class Parent_Covariant(Generic[T_co]):
    pass


class ShouldBeCovariant[T](Parent_Covariant[T]):
    pass


# This should generate an error.
b1: ShouldBeCovariant[int] = ShouldBeCovariant[float]()

b2: ShouldBeCovariant[float] = ShouldBeCovariant[int]()


class Parent_Contravariant(Generic[T_contra]):
    pass


class ShouldBeContravariant[T](Parent_Contravariant[T]):
    pass


c1: ShouldBeContravariant[int] = ShouldBeContravariant[float]()

# This should generate an error.
c2: ShouldBeContravariant[float] = ShouldBeContravariant[int]()
