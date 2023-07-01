# This sample tests that the type analyzer flags as an error
# an attempt to assign to or delete a generic type.

from typing import Dict

# This should generate an error because assignment
# of generic types isn't allowed.
Dict[str, int] = {}

# This should generate an error because deletion
# of generic types isn't allowed.
del Dict[str, int]
