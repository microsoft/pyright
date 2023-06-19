# This sample tests that a variable assigned in a doubly-nested loop
# eliminates any Unknowns.

# pyright: strict


def func():
    a_value: int = 0
    a_list: list[int] = []

    for _ in range(1):
        for _ in range(1):
            a_value = a_list[a_value]
