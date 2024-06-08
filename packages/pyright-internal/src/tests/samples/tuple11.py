# This sample tests the handling of magic methods on
# the tuple class.

# pyright: strict


def func1(t1: tuple[int, ...], t2: tuple[int, ...]) -> bool:
    return t1 >= t2


def func2(t1: tuple[int, ...], t2: tuple[str, int]) -> bool:
    return t1 < t2


def func3(t1: tuple[int, int], t2: tuple[int, ...]) -> bool:
    return t1 > t2


def func4(t1: tuple[int, ...], t2: tuple[str, ...]) -> bool:
    # This should generate an error
    return t1 <= t2  # pyright: ignore[reportUnknownVariableType]


def func5(t1: tuple[str | int, ...]) -> tuple[str | int, ...]:
    while len(t1) < 4:
        t1 = t1 + (0,)
    return t1
