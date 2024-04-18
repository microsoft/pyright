# This sample tests a doubly-nested loop with an indexed expression being
# updated each time.


def func1(m: list[str | int]):
    while True:
        if isinstance(m[0], str):
            x = m[0]
            y = x + ""
            m[0] = y
