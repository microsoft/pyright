# This sample tests that list and list comprehension type errors are
# reported up for correct overload selection.

import random
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    LiteralString,
)


# The join method is overloaded with both LiteralString and str variants.
# We need to use the str overload here.
def func(x: LiteralString):
    "".join([random.choice(x) for _ in range(8)])
