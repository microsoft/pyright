# This sample tests interleaved for and if clauses in a list comprehension.

# pyright: strict, reportUnnecessaryComparison=false

from typing import Union, List, Tuple

m1: List[Union[Tuple[int, int], None]] = []

a = [
    y + z + x[0]
    for x in m1
    if x is not None
    for y in x
    if y is not None
    for z in [1, None, 3]
    if z is not None
]
