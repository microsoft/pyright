# This sample tests a piece of code that involves lots
# of cyclical dependencies for type resolution.

from typing import Optional

n: Optional[str] = None
while True:
    if n is None:
        n = ""
    else:
        n = n + ""

