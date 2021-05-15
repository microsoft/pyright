# This sample verifies that a lone overload is reported
# as an error.

from typing import overload


# This should generate an error because there is only one overload.
@overload
def foo1() -> None:
    ...


# This should generate an error because there is only one overload.
@overload
def foo2(a: int) -> None:
    ...


def foo2(a: int) -> None:
    pass


# This should generate an error because there is no implementation.
@overload
def foo3() -> None:
    ...


@overload
def foo3(a: int) -> None:
    ...
