# This sample tests reporting of type argument count mismatch when
# used with generic type aliases.

from typing import Callable, ParamSpec, TypeVar, TypeVarTuple, Unpack


T1 = TypeVar("T1")
T2 = TypeVar("T2")
P = ParamSpec("P")
Tv1 = TypeVarTuple("Tv1")

TA1 = dict[T1, T2]

# This should generate an error if reportMissingTypeArguments is enabled.
a1: TA1
# This should generate an error because of too few type arguments.
a2: TA1[str]
a3: TA1[str, str]
# This should generate an error because of too many type arguments.
a4: TA1[str, str, str]

TA2 = Callable[P, T1]

# This should generate an error if reportMissingTypeArguments is enabled.
b1: TA2
# This should generate an error because of too few type arguments.
b2: TA2[...]
b3: TA2[..., int]
# This should generate an error because of too many type arguments.
b4: TA2[..., int, int]

TA3 = Callable[P, int]

# This should generate an error if reportMissingTypeArguments is enabled.
c1: TA3
c2: TA3[int]
c3: TA3[int, int]
c4: TA3[int, int, int]


TA4 = list[T1] | tuple[Unpack[Tv1]]

# This should generate an error if reportMissingTypeArguments is enabled.
d1: TA4
d2: TA4[int]
d3: TA4[int, int]
d4: TA4[int, int, int]
