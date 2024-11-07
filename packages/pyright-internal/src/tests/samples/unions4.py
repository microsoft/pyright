# This sample tests the incorrect usage of Union types.

from typing import Union

x = Union[int, str]

y = Union[int]

z = Union

# This should generate an error.
v1: Union[int]


# This should generate an error.
def func1() -> Union: ...


# This should generate an error.
var1: Union


# This should generate two errors.
def func2(x: (list | set)[int]):
    reveal_type(x)


# This should generate two errors.
def func3(x: Union[list, set][int]):
    reveal_type(x)
