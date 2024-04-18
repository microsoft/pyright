# This sample tests basic support for PEP 696 -- default types for TypeVars.

from typing import Any
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVar,
    TypeVarTuple,
    ParamSpec,
    Unpack,
)

S1 = TypeVar("S1")
S2 = TypeVar("S2", bound=int)
S3 = TypeVar("S3", bytes, str)

Ts0 = TypeVarTuple("Ts0")

P0 = ParamSpec("P0")


T1 = TypeVar("T1", default=int)

# This should generate an error because default must be a type expression.
T2 = TypeVar("T2", default=3)

TInt = TypeVar("TInt", bound=int)
T3 = TypeVar("T3", bound=float, default=TInt)

# This should generate an error because default must be a subtype of bound.
T4 = TypeVar("T4", bound=int, default=float)

# This should generate an error because S1 is not a subtype of int.
T6 = TypeVar("T6", bound=int, default=S1)

T7 = TypeVar("T7", bound=float, default=S2)

# This should generate an error because S3 is not a subtype of int.
T8 = TypeVar("T8", bound=float, default=S3)

T9 = TypeVar("T9", bound=list[Any], default=list[S1])

T10 = TypeVar("T10", bytes, str, default=str)

# This should generate an error because str | bytes isn't one of the constrained types.
T11 = TypeVar("T11", bytes, str, default=str | bytes)

# This should generate an error because S1 isn't one of the constrained types.
T12 = TypeVar("T12", bytes, str, default=S1)

T13 = TypeVar("T13", int, str)
T14 = TypeVar("T14", int, str, bool, default=T13)

# This should generate an error because the constraints for T13 are not compatible.
T15 = TypeVar("T15", int, complex, bool, default=T13)

T16 = TypeVar("T16", bound=int)
T17 = TypeVar("T17", int, complex, bool, default=T16)

# This should generate an error because the type of T16 is not compatible.
T18 = TypeVar("T18", str, list, default=T16)


Ts1 = TypeVarTuple("Ts1", default=Unpack[tuple[int]])

# This should generate an error because default must be unpacked tuple.
Ts2 = TypeVarTuple("Ts2", default=tuple[int])

# This should generate an error because default must be unpacked tuple.
Ts3 = TypeVarTuple("Ts3", default=int)

Ts4 = TypeVarTuple("Ts4", default=Unpack[Ts0])

# This should generate an error because default must be unpacked.
Ts5 = TypeVarTuple("Ts5", default=Ts0)

Ts6 = TypeVarTuple("Ts6", default=Unpack[tuple[int, ...]])

Ts7 = TypeVarTuple("Ts7", default=Unpack[tuple[S1, S2]])


P1 = ParamSpec("P1", default=[])

P2 = ParamSpec("P2", default=[int, str, None, int | None])

P3 = ParamSpec("P3", default=[int, S1])

P4 = ParamSpec("P4", default=[int])

P5 = ParamSpec("P5", default=...)

# This should generate an error because ParamSpec must be a list of types.
P6 = ParamSpec("P6", default=int)

# This should generate an error because ParamSpec must be a list of types.
P7 = ParamSpec("P7", default=3)

# This should generate an error because ParamSpec must be a list of types.
P8 = ParamSpec("P8", default=(1, int))

P9 = ParamSpec("P9", default=P0)
