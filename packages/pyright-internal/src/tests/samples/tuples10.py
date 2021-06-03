# This sample tests that inferred types for tuples strip
# literals under the appropriate circumstances.


from typing import List, Literal, Tuple


a1 = (1, 2)
t1: Literal["tuple[Literal[1], Literal[2]]"] = reveal_type(a1)

a2 = list((1, 2))
t2: Literal["list[int]"] = reveal_type(a2)

a3: List[Literal[1]] = list((1,))
t3: Literal["list[Literal[1]]"] = reveal_type(a3)


def func1(v1: Tuple[Literal[1], ...], v2: Tuple[Literal[1]]):
    a4 = set(v1)
    t4: Literal["set[Literal[1]]"] = reveal_type(a4)

    a5 = set(v2)
    t5: Literal["set[Literal[1]]"] = reveal_type(a5)


a6 = (1, "hi")
t6: Literal["tuple[Literal[1], Literal['hi']]"] = reveal_type(a6)

v4 = set(a6)
t7: Literal["set[int | str]"] = reveal_type(v4)
