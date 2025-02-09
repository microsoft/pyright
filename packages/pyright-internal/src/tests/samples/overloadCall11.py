# This sample tests the case that involves overloads within a protocol
# definition. It requires the type checker to retain multiple constraint
# sets when performing protocol matching.

from typing import Any, Protocol, Self, overload


class SupportsDivMod[T1, T2](Protocol):
    def __divmod__(self, other: T1, /) -> T2: ...


class SupportsRDivMod[T1, T2](Protocol):
    def __rdivmod__(self, other: T1, /) -> T2: ...


@overload
def divmod[T1, T2](x: SupportsDivMod[T1, T2], y: T1, /) -> T2: ...
@overload
def divmod[T1, T2](x: T1, y: SupportsRDivMod[T1, T2], /) -> T2: ...
def divmod(x: Any, y: Any, /) -> Any: ...


class A:
    @overload
    def __divmod__(self, x: Self, /) -> tuple[Self, Self]: ...
    @overload
    def __divmod__(self, x: int, /) -> tuple[int, int]: ...
    def __divmod__(self, x: Self | int, /) -> tuple[Self, Self] | tuple[int, int]:
        return (self, self) if isinstance(x, A) else (x, x)


a = A()
reveal_type(divmod(a, a), expected_text="tuple[A, A]")
reveal_type(divmod(a, 1), expected_text="tuple[int, int]")


class B(A): ...


b = B()
reveal_type(divmod(b, b), expected_text="tuple[B, B]")
