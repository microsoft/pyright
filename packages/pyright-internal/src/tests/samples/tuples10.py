# This sample tests that inferred types for tuples strip
# literals when there is no expected type or the expected
# type is not a heterogeneous tuple.


from typing import List, Literal


a1 = (1, 2)
t1: Literal["Tuple[Literal[1], Literal[2]]"] = reveal_type(a1)

a2 = list((1, 2))
t2: Literal["list[int]"] = reveal_type(a2)

a3: List[Literal[1]] = list((1,))
t3: Literal["list[Literal[1]]"] = reveal_type(a3)
