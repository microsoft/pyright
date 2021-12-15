# This sample tests loops that contain nested comprehensions and
# variables that depend on each other.

# pyright: strict


def func1(boards: list[list[list[int]]]):
    for _ in [0]:
        remain = [[set(line) for line in zip(*b)] for b in boards]
        boards = [b for b, u in zip(boards, remain) if all(u)]


def func2(boards: list[list[list[int]]]):
    for _ in [1]:
        remain = [[set(line) for line in b] for b in boards]
        boards = [b for b, u in zip(boards, remain) if all(u)]


def func3(boards: list[list[list[int]]]):
    for _ in [1]:
        remain = [[set(line) for line in (*b, *zip(*b))] for b in boards]
        boards = [b for b, u in zip(boards, remain) if all(u)]
