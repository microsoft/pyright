# This sample tests the case where bidirectional type inference fails
# because a particular set of nested constructor calls and variance
# combinations makes it impossible to infer the correct type arguments
# using bidirectional type inference. We need to fall back to using
# regular evaluation rules in this case.

from typing import Iterable, Sequence

list1 = [1]


class NT(tuple[list]): ...


x1: Iterable[NT | Sequence] = list(zip(list1))
