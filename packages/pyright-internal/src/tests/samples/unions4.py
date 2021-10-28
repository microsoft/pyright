# This sample tests the incorrect usage of Union types.

from typing import Union

x = Union[int, str]


# This should generate an error.
y = Union[int]

z = Union


# This should generate an error.
def func1() -> Union:
    ...


# This should generate an error.
var1: Union
