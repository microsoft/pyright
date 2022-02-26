# This sample tests the handling of type checking of overloaded methods
# and functions. In particular, it handles the case where the destination
# is an overload and the source is either another overload or a function
# type. This case is important for protocol matching if the protocol
# includes an overloaded method.

from fractions import Fraction
from typing import Any, Optional, Protocol, TypeVar, Union, overload

v1 = round(Fraction(1))


_T_co = TypeVar("_T_co", covariant=True)
_T = TypeVar("_T")


class SupportsRound1(Protocol[_T_co]):
    @overload
    def __round__(self) -> int:
        ...

    @overload
    def __round__(self, ndigits: int) -> _T_co:
        ...

    # This should generate an error because the return type isn't compatible.
    def __round__(self, ndigits: int = 0) -> _T_co:
        ...


class Proto1:
    def __round__(self, ndigits: int) -> "Fraction":
        ...


def round1(number: SupportsRound1[Any]) -> int:
    ...


v_proto1 = Proto1()

# This should generate an error
v_round1 = round1(v_proto1)


class Proto2:
    @overload
    def __round__(self, ndigits: int) -> "Fraction":
        ...

    @overload
    def __round__(self, ndigits: None = ...) -> int:
        ...

    def __round__(self, ndigits: Optional[int] = None) -> Union["Fraction", int]:
        ...


def round2(number: SupportsRound1[Any]) -> int:
    ...


v_proto2 = Proto2()
v_round2 = round2(v_proto2)
