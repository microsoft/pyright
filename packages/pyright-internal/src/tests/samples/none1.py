# This sample tests properties of the special NoneType.

from typing import Hashable, Iterable, Optional

a: Hashable = None

# This should generate an error because None isn't iterable.
b: Iterable = None

c = None
c.__class__
c.__doc__


def func1(a: Optional[int]):
    a.__class__
    a.__doc__


def func2(x: type[None]):
    ...


func2(None.__class__)
func2(type(None))
