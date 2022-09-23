# This sample tests that a class-scoped TypeVar used to parameterize
# a base class within a class definition cannot be covariant or
# contravariant if the base class requires an invariant type parameter.

from typing import Generic, TypeVar

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)
T_contra = TypeVar("T_contra", contravariant=True)

# This should generate an error because the type parameter for list
# is invariant, so T_co here cannot be covariant.
class MyList1(list[T_co]): pass

# This should generate an error because the type parameter for list
# is invariant, so T_co here cannot be contravariant.
class MyList2(list[T_contra]): pass

class ClassCo(Generic[T_co]): ...

class ChildCo1(ClassCo[T_co]): ...
class ChildCo2(ClassCo[T]): ...

# This should generate an error because T_contra isn't 
# compatible with T_co.
class ChildCo3(ClassCo[T_contra]): ...

class ClassContra(Generic[T_contra]): ...

class ChildContra1(ClassContra[T_contra]): ...
class ChildContra2(ClassContra[T]): ...

# This should generate an error because T_co isn't 
# compatible with T_contra.
class ChildContra3(ClassContra[T_co]): ...

