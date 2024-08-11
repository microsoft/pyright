# This sample verifies that unknown types are properly eliminated from
# a loop.

# pyright: strict


def func1(a: int, b: str, c: str):
    v1: list[tuple[str, str, str]] = []
    for _ in range(0):
        if a == 0:
            print(v1[-1][0])
            last = v1[-1]
            v1[-1] = (b, last[1], c)
