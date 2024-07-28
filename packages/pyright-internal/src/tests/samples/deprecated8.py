# This sample tests reporting of deprecated magic methods.

# pyright: reportMissingModuleSource=false

from typing import Self, overload

from typing_extensions import deprecated


class ClassA:
    @deprecated("Adding a str is deprecated")
    @overload
    def __add__(self, other: str) -> Self: ...

    @overload
    def __add__(self, other: object) -> Self: ...

    def __add__(self, other: object) -> Self: ...

    @deprecated("Bool is not supported")
    def __bool__(self) -> bool: ...

    @deprecated("Negation is no longer supported")
    def __neg__(self) -> Self: ...


a = ClassA()

v1 = a + 1

# This should be marked as deprecated.
v2 = a + ""

a += 1

# This should be marked as deprecated.
a += ""


# This should be marked as deprecated.
v3 = -a

# This should be marked as deprecated.
v4 = not a
