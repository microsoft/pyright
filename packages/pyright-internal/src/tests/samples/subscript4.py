# This sample tests the handling of a subscript in a loop that includes
# a del statement.

# pyright: strict


def func1(lst: list[tuple[int, int]]):
    for _ in range(1):
        lst[-1] = lst[-1][1], lst[-1][0]
        del lst[-1]
