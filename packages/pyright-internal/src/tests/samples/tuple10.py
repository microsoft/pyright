# This sample tests that inferred types for tuples strip
# literals under the appropriate circumstances.


from typing import Literal


a1 = (1, 2)
reveal_type(a1, expected_text="tuple[Literal[1], Literal[2]]")

a2 = list((1, 2))
reveal_type(a2, expected_text="list[Literal[1, 2]]")

a3: list[Literal[1]] = list((1,))
reveal_type(a3, expected_text="list[Literal[1]]")


def func1(v1: tuple[Literal[1], ...], v2: tuple[Literal[1]]):
    a4 = set(v1)
    reveal_type(a4, expected_text="set[Literal[1]]")

    a5 = set(v2)
    reveal_type(a5, expected_text="set[Literal[1]]")


a6 = (1, "hi")
reveal_type(a6, expected_text="tuple[Literal[1], Literal['hi']]")

v4 = set(a6)
reveal_type(v4, expected_text="set[Literal[1, 'hi']]")
