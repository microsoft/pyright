# This sample tests a complex interplay between protocols and bound TypeVars.
# This case involves numpy types and has regressed in the past.


from typing import Protocol, Self, TypeVar

TD = TypeVar("TD", bound="TimeDeltaProto")
DT = TypeVar("DT", bound="DateTimeProto")


class TimeDeltaProto(Protocol):
    def __pos__(self) -> Self: ...


class DateTimeProto(Protocol[TD]):
    def __add__(self, other: TD, /) -> Self: ...

    def __sub__(self, other: Self, /) -> TD: ...


class TimeDelta:
    def __pos__(self) -> Self: ...


class DateTime:
    def __add__(self, other: bool | int) -> Self: ...

    def __sub__(self, other: "DateTime") -> TimeDelta: ...


def func1(__val: DT) -> DT:
    return __val


dt = DateTime()
reveal_type(func1(dt), expected_text="DateTime")
