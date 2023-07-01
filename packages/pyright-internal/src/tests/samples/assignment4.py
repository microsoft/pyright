# This sample tests various assignment scenarios where
# there is an expected type, so bidirectional type
# inference is used.

# pyright: strict

from typing import Callable, Sequence

AAA = float
BBB = int
CCC = str
DDD = str
AAATuple = tuple[AAA, BBB, Callable[[Sequence[int], AAA], Sequence[float]]]


def foo():
    var1: dict[str, tuple[AAA, BBB, CCC, DDD]] = {}
    var2: dict[str, AAATuple] = {}
    for k, (var3, var4, _, _) in var1.items():
        var2[k] = (var3, var4, lambda var5, var6: [v * var6 for v in var5])
