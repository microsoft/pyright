# This sample tests the ability to detect errant assert calls
# that are always true - the "reportAssertAlwaysTrue" option.

# This should generate a warning.
from typing import Any, Tuple


assert (1 != 2, "Error message")

a: Tuple[Any, ...] = (2, 3)
assert a


b = ()
assert b


c = (2, 3)

# This should generate a warning.
assert c

