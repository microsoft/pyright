# This sample tests that a failed protocol match for one specialization of a
# generic class doesn't affect protocol matches for other specializations.

from typing import TYPE_CHECKING, Generic, Protocol, TypeVar, assert_type, overload

T_contra = TypeVar("T_contra", contravariant=True)
T = TypeVar("T")
S = TypeVar("S")
S_contra = TypeVar("S_contra", contravariant=True)


class ElementOpsMixin(Generic[S]):
    @overload
    def _proto_add(self: "ElementOpsMixin[bool]", other: bool, /) -> "ElementOpsMixin[bool]": ...

    @overload
    def _proto_add(self: "ElementOpsMixin[int]", other: int, /) -> "ElementOpsMixin[int]": ...

    def _proto_add(self, other: object, /) -> object:
        return self


class SupportsProtoAdd(Protocol[T_contra, T]):
    def _proto_add(self, other: T_contra, /) -> ElementOpsMixin[T]: ...


class Series(ElementOpsMixin[S], Generic[S]):
    @overload
    def __add__(self: SupportsProtoAdd[S_contra, S], other: S_contra, /) -> "Series[S]": ...

    @overload
    def __add__(self: "Series[bool]", other: int, /) -> "Series[int]": ...

    def __add__(self, other: object, /) -> object:
        return self


class A:
    pass


class B:
    pass


series_a: Series[A] = Series()
b = B()

if TYPE_CHECKING:
    _ = series_a + b  # pyright: ignore[reportOperatorIssue, reportUnknownVariableType]

series_bool: Series[bool] = Series()
result = series_bool + True
assert_type(result, Series[bool])


# Verify the equivalent case where the protocol member rather than the source
# member is overloaded.
class DestinationElement(Generic[S]):
    def method(self, value: S) -> "DestinationElement[S]":
        return self


class DestinationProtocol(Protocol[T_contra, T]):
    @overload
    def method(self: DestinationElement[bool], value: T_contra) -> DestinationElement[T]: ...

    @overload
    def method(self: DestinationElement[int], value: T_contra) -> DestinationElement[T]: ...


class DestinationSeries(DestinationElement[S], Generic[S]):
    @overload
    def __add__(
        self: DestinationProtocol[S_contra, S], other: S_contra
    ) -> "DestinationSeries[S]": ...

    @overload
    def __add__(  # pyright: ignore[reportOverlappingOverload]
        self: "DestinationSeries[bool]", other: int
    ) -> "DestinationSeries[int]": ...

    def __add__(self, other: object) -> object:
        return self


destination_series_a: DestinationSeries[A] = DestinationSeries()

if TYPE_CHECKING:
    _ = destination_series_a + b  # pyright: ignore[reportOperatorIssue, reportUnknownVariableType]

destination_series_bool: DestinationSeries[bool] = DestinationSeries()
destination_result = destination_series_bool + True
assert_type(destination_result, DestinationSeries[bool])
