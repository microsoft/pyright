# This sample tests a case where "self" refers to a class with type
# parameters that have default values. This is a case that regressed.


class Base: ...


class A(Base): ...


class B[T: Base = A]:
    def __init__(self, x: T) -> None:
        self._x = x

    @property
    def x(self) -> T:
        return self._x
