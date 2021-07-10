# This sample tests that a diagnostic is emitted when an overload
# function contains an implementation.

from typing import Union, overload


@overload
def func1(x: int) -> int:
    ...


# This should generate an error.
@overload
def func1(x: str) -> str:
    return x


def func1(x: Union[int, str]) -> Union[int, str]:
    return x
