# This sample tests the type checker's handling of derived specialized
# objects assigned to their parent class type (also specialized).

from typing import Generic, TypeVar

T = TypeVar("T", bound=float)


class Base1(Generic[T]):
    pass


class Derived1(Base1[T]):
    pass


val1: Base1[int] = Derived1[int]()


class Base2(Generic[T]):
    pass


class Derived2(Base2[float], Generic[T]):
    pass


val2_1: Base2[float] = Derived2[int]()

# This should generate an error because Derived2[int]
# isn't assignable to Base2[int].
val2_2: Base2[int] = Derived2[int]()
