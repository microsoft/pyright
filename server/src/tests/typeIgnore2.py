# This sample tests the type: ignore for individual lines.

from typing import Dict


a: int = 3
b = len(a) # type: ignore

for for for # type: ignore

c: Dict[str, str] = {
    3: 3,
    'hello': 3,
    3.2: 2.4
} #type:ignore # something





