# This sample tests the TypeVar constraint solver in cases where
# generic protocols are used.

from datetime import timedelta
from typing import Any, Generic, Literal, Protocol, TypeVar, overload

_X_co = TypeVar("_X_co", covariant=True)
_X_contra = TypeVar("_X_contra", contravariant=True)


class SupportsDivMod(Protocol, Generic[_X_contra, _X_co]):
    def __divmod__(self, __other: _X_contra) -> _X_co:
        ...


class SupportsRDivMod(Protocol[_X_contra, _X_co]):
    def __rdivmod__(self, __other: _X_contra) -> _X_co:
        ...


@overload
def divmod(__x: SupportsDivMod[_X_contra, _X_co], __y: _X_contra) -> _X_co:
    ...


@overload
def divmod(__x: _X_contra, __y: SupportsRDivMod[_X_contra, _X_co]) -> _X_co:
    ...


def divmod(__x: Any, __y: Any) -> Any:
    ...


t1: Literal["Tuple[int, timedelta]"] = reveal_type(
    divmod(timedelta(minutes=90), timedelta(hours=1))
)
t2: Literal["Tuple[int, int]"] = reveal_type(divmod(3, 4))
t3: Literal["Tuple[float, float]"] = reveal_type(divmod(3.6, 4))
t4: Literal["Tuple[float, float]"] = reveal_type(divmod(3, 4.5))


class SupportsLessThan(Protocol):
    def __lt__(self, __other: Any) -> bool:
        ...


SupportsLessThanT = TypeVar("SupportsLessThanT", bound=SupportsLessThan)


def max2(__arg1: SupportsLessThanT, __arg2: SupportsLessThanT) -> SupportsLessThanT:
    ...


def min2(__arg1: SupportsLessThanT, __arg2: SupportsLessThanT) -> SupportsLessThanT:
    ...


def func1():
    x = max2(1, min2(1, 4.5))
    t_x: Literal["float"] = reveal_type(x)
