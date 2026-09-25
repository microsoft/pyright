# This sample tests overloaded methods that add mutually exclusive overloads
# when overriding another overloaded method.

# pyright: reportIncompatibleMethodOverride=true, reportOverlappingOverload=false

from typing import Literal, overload


class Base:
    @overload
    def map(self, x: str, wrap: Literal[True]) -> tuple[str]: ...

    @overload
    def map(self, x: int, wrap: Literal[True]) -> tuple[int]: ...

    def map(self, x: str | int, wrap: Literal[True]) -> tuple[str] | tuple[int]:
        raise NotImplementedError


class ExtrasFirst(Base):
    @overload
    def map(self, x: str, wrap: Literal[False] = False) -> str: ...

    @overload
    def map(self, x: int, wrap: Literal[False] = False) -> int: ...

    @overload
    def map(self, x: str, wrap: Literal[True]) -> tuple[str]: ...

    @overload
    def map(self, x: int, wrap: Literal[True]) -> tuple[int]: ...

    def map(self, x: str | int, wrap: bool = False) -> str | int | tuple[str] | tuple[int]:
        raise NotImplementedError


class ExtrasLast(Base):
    @overload
    def map(self, x: str, wrap: Literal[True]) -> tuple[str]: ...

    @overload
    def map(self, x: int, wrap: Literal[True]) -> tuple[int]: ...

    @overload
    def map(self, x: str, wrap: Literal[False] = False) -> str: ...

    @overload
    def map(self, x: int, wrap: Literal[False] = False) -> int: ...

    def map(self, x: str | int, wrap: bool = False) -> str | int | tuple[str] | tuple[int]:
        raise NotImplementedError


class ReorderedMatches(Base):
    @overload
    def map(self, x: int, wrap: Literal[True]) -> tuple[int]: ...

    @overload
    def map(self, x: str, wrap: Literal[True]) -> tuple[str]: ...

    # This should generate an error because matching overloads remain ordered.
    def map(self, x: str | int, wrap: Literal[True]) -> tuple[str] | tuple[int]:
        raise NotImplementedError


class IncompatibleOverlap(Base):
    @overload
    def map(self, x: str, wrap: bool) -> str: ...

    @overload
    def map(self, x: str, wrap: Literal[True]) -> tuple[str]: ...

    @overload
    def map(self, x: int, wrap: Literal[True]) -> tuple[int]: ...

    # This should generate an error because the additional overload overlaps
    # incompatibly even though later overloads match all base overloads.
    def map(self, x: str | int, wrap: bool) -> str | tuple[str] | tuple[int]:
        raise NotImplementedError


class BroadOverlapHidesBase(Base):
    @overload
    def map(self, x: str | int, wrap: Literal[True]) -> tuple[str]: ...

    @overload
    def map(self, x: str, wrap: Literal[True]) -> tuple[str]: ...

    @overload
    def map(self, x: int, wrap: Literal[True]) -> tuple[int]: ...

    # This should generate an error because the first override is compatible
    # with the string base overload but overlaps the integer overload incompatibly.
    def map(self, x: str | int, wrap: Literal[True]) -> tuple[str] | tuple[int]:
        raise NotImplementedError


class SameReturnBase:
    @overload
    def convert(self, x: str) -> object: ...

    @overload
    def convert(self, x: int) -> object: ...

    def convert(self, x: str | int) -> object:
        raise NotImplementedError


class BroadCoversMultiple(SameReturnBase):
    @overload
    def convert(self, x: str | int) -> object: ...

    @overload
    def convert(self, x: bytes) -> object: ...

    def convert(self, x: str | int | bytes) -> object:
        raise NotImplementedError


class OrderedOverlapBase:
    @overload
    def select(self, x: int) -> int: ...

    @overload
    def select(self, x: object) -> object: ...

    def select(self, x: object) -> object:
        raise NotImplementedError


class IdenticalOrderedOverlap(OrderedOverlapBase):
    @overload
    def select(self, x: int) -> int: ...

    @overload
    def select(self, x: object) -> object: ...

    def select(self, x: object) -> object:
        raise NotImplementedError


class SplitDomainBase:
    @overload
    def choose(self, x: str) -> str: ...

    @overload
    def choose(self, x: float) -> float: ...

    @overload
    def choose(self, x: bytes) -> str: ...

    def choose(self, x: str | float | bytes) -> str | float:
        raise NotImplementedError


class ReorderedSplitDomain(SplitDomainBase):
    @overload
    def choose(self, x: float) -> float: ...

    @overload
    def choose(self, x: str | bytes) -> str: ...

    # This should generate an error because this overload newly covers base
    # overloads on both sides of the previously matched float overload.
    def choose(self, x: str | float | bytes) -> str | float:
        raise NotImplementedError
