# The same expression restrictions apply to stringized future annotations.
from __future__ import annotations

from typing import Annotated

# scope error
value: Annotated[int, (metadata := 1)] = 0

# scope error
lambda_default: Annotated[int, lambda arg=(default_meta := 1): arg] = 0

lambda_body: Annotated[int, lambda: (lambda_meta := 1)] = 0
comprehension_body: Annotated[int, [(list_meta := item) for item in (1, 2)]] = 0
OrdinaryAlias = Annotated[int, (assignment_meta := 1)]
quoted: "Annotated[int, (quoted_meta := 1)]" = 0
