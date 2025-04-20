# This sample tests that named tuple field names beginning with
# an underscore is flagged as an error.

from collections import namedtuple
from typing import NamedTuple

# This should generate an error because a field name starting with an
# underscore isn't allowed.
NT1 = namedtuple("NT1", ["_oops"])

# This should generate an error because a field name starting with an
# underscore isn't allowed.
NT2 = namedtuple("NT2", "a, b, _oops")


class NT3(NamedTuple):
    # This should generate an error because a field name starting with an
    # underscore isn't allowed.
    _oops: int
