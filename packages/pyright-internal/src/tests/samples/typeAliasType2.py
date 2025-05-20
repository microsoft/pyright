# This sample tests the TypeAliasType constructor.

from typing import Callable, Generic, ParamSpec, TypeVar, TypeVarTuple
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeAliasType,
)

T1 = TypeVar("T1")

S = TypeVar("S", bound=int)
T = TypeVar("T", bound=str)
P = ParamSpec("P")
Ts = TypeVarTuple("Ts")

TA1 = TypeAliasType("TA1", "T1 | list[TA1[T1]]", type_params=(T1,))

x1: TA1[int] = 1
x2: TA1[int] = [1]

TA2 = TypeAliasType(
    "TA2",
    "Callable[P, T] | list[S] | list[TA2[S, T, P]] | tuple[*Ts]",
    type_params=(S, T, P, Ts),
)


# This should generate an error because str isn't compatible with S bound.
x3: TA2[str, str, ..., int, str]

x4: TA2[int, str, ..., int, str]

# This should generate an error because int isn't compatible with T bound.
x5: TA2[int, int, ...]

x6: TA2[int, str, [int, str], *tuple[int, str, int]]

# This should generate an error because it is unresolvable.
TA3 = TypeAliasType("TA3", TA3)

# This should generate an error because it is unresolvable.
TA4 = TypeAliasType("TA4", "T | TA4[str]", type_params=(T,))

TA5 = TypeAliasType("TA5", "T | list[TA5[T]]", type_params=(T,))

# This should generate an error because it is unresolvable.
TA6 = TypeAliasType("TA6", "TA7")
TA7 = TypeAliasType("TA7", "TA6")

JSONNode = TypeAliasType(
    "JSONNode", "list[JSONNode] | dict[str, JSONNode] | str | float"
)


class A(Generic[T1]):
    L = TypeAliasType("L", list[T1])


a1: A[int].L = [1, 2, 3]
a2: A[str].L = ["1", "2", "3"]

# This should generate an error because S is not in scope.
TA8 = TypeAliasType("TA8", list[S])


def identity[T](t: T) -> T:
    return t


reveal_type(identity(TA1), expected_text="TypeAliasType")


class B:
    TA9 = TypeAliasType("TA9", T1 | list[T1], type_params=(T1,))


b1: B.TA9[int]


# This should generate an error because TA9 refers to itself
# and is not quoted.
TA9 = TypeAliasType("TA9", list[TA9])
