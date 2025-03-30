# This sample tests a loop where there are multiple symbols
# that depend on each other.

# pyright: strict


def func1() -> str | None: ...


s1: str | None = None
s2 = None
while True:
    obj = func1()

    x = s2
    condition = obj and obj != s1

    s1 = obj
    s2 = obj
