# This sample tests that __future__ imports are found
# only at the beginning of a file.

from typing import Any
from __future__ import annotations  # This should generate an error
