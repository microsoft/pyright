# Specializing a TypeVarTuple can synthesize a function with no type-var
# scope. Its typed variadic parameters still require __new__ validation.

from typing import Generic, Self, TypeVarTuple

Ts = TypeVarTuple("Ts")


class Allocation(Generic[*Ts]):
    def __new__(cls, *args: *Ts, **kwargs: str) -> Self: ...

    def __init__(self, *args: object, **kwargs: object) -> None: ...


class InheritedAllocation(Allocation[*Ts]): ...


Allocation[*tuple[int, ...]](1, 2, key="ok")
Allocation[*tuple[int, ...]]("bad")  # E
Allocation[*tuple[int, ...]](key=1)  # E
InheritedAllocation[*tuple[int, ...]](1, 2, key="ok")
InheritedAllocation[*tuple[int, ...]]("bad")  # E
InheritedAllocation[*tuple[int, ...]](key=1)  # E

# Fixed-size specializations must continue to check both parameter types.
Allocation[int, int](1, 2, key="ok")
Allocation[int, int](1, "bad")  # E
Allocation[int, int](1, 2, key=1)  # E


class NewOnly(Generic[*Ts]):
    def __new__(cls, *args: *Ts, **kwargs: str) -> Self: ...


# Without __init__, __new__ must also be validated non-speculatively.
NewOnly[*tuple[int, ...]](1, 2, key="ok")
NewOnly[*tuple[int, ...]]("bad")  # E
NewOnly[*tuple[int, ...]](key=1)  # E
NewOnly[int, int](1, 2, key="ok")
NewOnly[int, int](1, "bad")  # E
NewOnly[int, int](1, 2, key=1)  # E


# A non-generic subclass still inherits the typed, unbounded __new__.
class IntAllocation(Allocation[*tuple[int, ...]]): ...


IntAllocation(1, 2, key="ok")
IntAllocation("bad")  # E
IntAllocation(key=1)  # E
