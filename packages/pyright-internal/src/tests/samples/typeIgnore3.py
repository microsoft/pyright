# This sample tests the type: ignore for individual lines.
# It uses a form of ignore syntax that is not part of the
# official PEP 484 spec but is a variant supported by mypy.

from typing import Dict


a: int = 3
b = len(a) # type: ignore[1424]

for for for # type: ignore[1424, 244]

c: Dict[str, str] = {
    3: 3,
    'hello': 3,
    3.2: 2.4
} #type:ignore[999] # something





