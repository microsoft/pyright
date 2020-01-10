# This sample checks that isinstance and issubclass don't
# allow the second argument to be a Protocol class.

from typing import Iterable, Sized


# This should generate an error because Sized is a Protocol.
isinstance(4, Sized)


# This should generate an error because Iterable is a Protocol.
issubclass(str, (str, Iterable))

