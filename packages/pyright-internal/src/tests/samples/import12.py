# This sample tests the reportWildcardImportFromLibrary option.

# This should generate a warning or error depending on whether
# strict mode is enabled.
from typing import *

# This should also generate the same warning or error. It's here to
# a double (redundant) wildcard import.
from typing import *


reveal_type(Dict, expected_text="type[Dict[Unknown, Unknown]]")
