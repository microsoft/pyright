# This sample tests a doubly-nested loop with a function (max) that
# uses a TypeVar.

from typing import Any, Protocol, TypeAlias, TypeVar

_T_contra = TypeVar("_T_contra", contravariant=True)


class SupportsDunderGT(Protocol[_T_contra]):
    def __gt__(self, __other: _T_contra) -> bool: ...


class SupportsDunderLT(Protocol[_T_contra]):
    def __lt__(self, __other: _T_contra) -> bool: ...


SupportsRichComparison: TypeAlias = SupportsDunderLT[Any] | SupportsDunderGT[Any]

SupportsRichComparisonT = TypeVar(
    "SupportsRichComparisonT", bound=SupportsRichComparison
)


def max(
    __arg1: SupportsRichComparisonT, __arg2: SupportsRichComparisonT
) -> SupportsRichComparisonT: ...


a: int = 1
while True:
    while a >= 0:
        a -= 1
    a = max(0, a)
