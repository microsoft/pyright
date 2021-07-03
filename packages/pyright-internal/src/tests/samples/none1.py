# This sample tests properties of the special NoneType.

from typing import Hashable, Iterable

a: Hashable = None

# This should generate an error because None isn't iterable.
b: Iterable = None

c = None
c.__class__
c.__doc__

