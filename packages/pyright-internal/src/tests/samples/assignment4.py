# This sample tests various assignment scenarios where
# there is an expected type, so bidirectional type
# inference is used.

# pyright: strict

from typing import Dict, Callable, Sequence, Tuple
AAA = float
BBB = int
CCC = str
DDD = str
AAATuple = Tuple[AAA, BBB, Callable[[Sequence[int], AAA], Sequence[float]]]

def foo():
    var1: Dict[str, Tuple[AAA, BBB, CCC, DDD]] = {}
    var2: Dict[str, AAATuple] = {}
    for k, (var3, var4, _, _) in var1.items():
        var2[k] = (var3, var4, lambda var5, var6: [v * var6 for v in var5])
