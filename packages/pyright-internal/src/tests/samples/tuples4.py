# This sample tests the translation of a heterogenous tuple
# into an Iterable.

from typing import Iterable, TypeVar, Union

_T = TypeVar("_T")


def foo(x: Iterable[_T]) -> Iterable[_T]:
    return x


def bar(x: Iterable[Union[int, str]]):
    pass


my_tuple = (3, "hello")

# The type of my_iterable should be Iterable[Union[int, str]].
my_iterable = foo(my_tuple)
bar(my_iterable)
