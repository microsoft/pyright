# Bare assignment expressions in subscripts require Python 3.10, independently
# of the restriction on assignment expressions in stringized annotations.
from __future__ import annotations

from typing import Annotated

value: Annotated[int, metadata := 1] = 0
