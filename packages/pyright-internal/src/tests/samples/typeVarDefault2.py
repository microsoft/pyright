# This sample tests the PEP 695 type parameter syntax extensions introduced
# in PEP 696 (default types for TypeVarLike).

from typing import Any, ParamSpec, TypeVar, Unpack
from typing_extensions import TypeVarTuple  # pyright: ignore[reportMissingModuleSource]

T1 = TypeVar("T1")
Ts1 = TypeVarTuple("Ts1")
P1 = ParamSpec("P1")


# This should generate an error because default must be a type expression.
class ClassT1[T = 3]: ...


class ClassT2[T: float = int]: ...


# This should generate an error because default must be a subtype of bound.
class ClassT3[T: int = float]: ...


class ClassT4[T: list[Any] = list[int]]: ...


class ClassT5[T: (bytes, str) = str]: ...


# This should generate an error because str | bytes isn't one of the constrained types.
class ClassT6[T: (bytes, str) = str | bytes]: ...


# This should generate an error because T1 is not a valid default.
class ClassT7[T = T1]: ...


# This should generate an error because Ts1 is not a valid default.
class ClassT8[T = Ts1]: ...


# This should generate an error because P1 is not a valid default.
class ClassT9[T = P1]: ...


class ClassTs1[*Ts = *tuple[int]]: ...


class ClassTs2[*Ts = Unpack[tuple[int]]]: ...


# This should generate an error because default must be unpacked tuple.
class ClassTs3[*Ts = tuple[int]]: ...


# This should generate an error because default must be unpacked tuple.
class ClassTs4[*Ts = int]: ...


# This should generate an error because default must be unpacked tuple.
class ClassTs5[*Ts = T1]: ...


# This should generate an error because default must be unpacked tuple.
class ClassTs6[*Ts = Ts1]: ...


# This should generate an error because default must be unpacked tuple.
class ClassTs7[*Ts = P1]: ...


class ClassTs8[*Ts = Unpack[tuple[int, ...]]]: ...


# This should generate an error because T1 isn't legal here.
class ClassTs9[*Ts = Unpack[tuple[T1, T1]]]: ...


# This should generate an error because ... isn't legal here.
class ClassTs10[*Ts = ...]: ...


class ClassP1[**P = [int]]: ...


class ClassP2[**P = ...]: ...


class ClassP3[**P = []]: ...


class ClassP4[**P = [int, str, None, int | None]]: ...


# This should generate an error because T1 isn't legal here.
class ClassP5[**P = [T1]]: ...


# This should generate an error because ParamSpec must be a list of types.
class ClassP6[**P = int]: ...


# This should generate an error because ParamSpec must be a list of types.
class ClassP7[**P = 3]: ...


# This should generate an error because ParamSpec must be a list of types.
class ClassP8[**P = [1, int]]: ...


# This should generate an error because it combines a traditional ParamSpec
# with a new-style (PEP 695) ParamSpec.
class ClassP9[**P = P1]: ...


# This should generate an error because ParamSpec must be a list of types.
class ClassP10[**P = Ts1]: ...
