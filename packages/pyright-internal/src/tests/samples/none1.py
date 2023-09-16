# This sample tests properties of the special NoneType.

from typing import Hashable, Iterable

a: Hashable = None

# This should generate an error because None isn't iterable.
b: Iterable = None

c = None
v1 = c.__class__
v2 = c.__doc__


def func1(a: int | None):
    v1 = a.__class__
    v2 = a.__doc__


def func2(x: type[None]):
    ...


func2(None.__class__)
func2(type(None))

reveal_type(type(None).__name__, expected_text="str")

_ = type(None) == type(None)

None.__eq__(0)
