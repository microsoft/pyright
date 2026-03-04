# This sample tests that overlapping-overload diagnostics for explicit self
# annotations are stable regardless of whether a related subclass stores its
# backing attribute under a public or a private name.
#
# Previously, private names (_f) caused variance to be inferred as covariant
# instead of invariant, which produced false-positive reportOverlappingOverload
# errors even though the overloads were semantically non-overlapping.
#
# The PEP 695 [T] syntax is required to trigger the bug because those TypeVars
# use auto-variance inference, unlike old-style TypeVar("T") which is always
# treated as invariant.

from __future__ import annotations

from typing import Any, Callable, overload


class Mixin[T]:
    @property
    def value(self) -> T: ...

    @overload
    def __abs__(self: "Mixin[complex]") -> "Mixin[float]": ...

    @overload
    def __abs__(self: "Mixin[bool]") -> "Mixin[int]": ...

    @overload
    def __abs__(self) -> "Mixin[T]": ...

    def __abs__(self) -> Any: ...


# Public backing attribute: variance of T is inferred as invariant (always worked).
class Public[T](Mixin[T]):
    def __init__(self, f: Callable[[], T]) -> None:
        self.f = f

    @property
    def value(self) -> T:
        return self.f()


# Private backing attribute: previously caused variance to be inferred as
# covariant, which triggered false-positive reportOverlappingOverload errors.
class Private[T](Mixin[T]):
    def __init__(self, f: Callable[[], T]) -> None:
        self._f = f

    @property
    def value(self) -> T:
        return self._f()
