# This sample tests that a class-scoped TypeVar used to parameterize
# a base class within a class definition cannot be covariant or
# contravariant if the base class requires an invariant type parameter.

from typing import TypeVar

T_co = TypeVar("T_co", covariant=True)
T_contra = TypeVar("T_contra", contravariant=True)

# This should generate an error because the type parameter for list
# is invariant, so T_co here cannot be covariant.
class MyList1(list[T_co]): pass

# This should generate an error because the type parameter for list
# is invariant, so T_co here cannot be contravariant.
class MyList2(list[T_contra]): pass
