# This sample tests that the parameters of an overload implementation are not
# subject to the reportUnknownParameterType and reportMissingParameterType
# checks. The implementation signature is ignored by the type checker, so its
# parameters are allowed to remain unannotated.

# pyright: strict

from typing import overload


class Foo:
    @overload
    def foo(self, value: int) -> int: ...

    @overload
    def foo(self, value: str) -> str: ...

    # The unannotated "value" parameter should not generate errors here.
    def foo(self, value) -> int | str:
        return 0


@overload
def func1(value: int) -> int: ...


@overload
def func1(value: str) -> str: ...


# The unannotated "value" parameter should not generate errors here.
def func1(value) -> int | str:
    return 0


# A non-overloaded function with an unannotated parameter should still
# generate errors.
def func2(value) -> int:
    # This should generate an error because "value" has an unknown type and
    # an error because "value" is missing a type annotation.
    return 1
