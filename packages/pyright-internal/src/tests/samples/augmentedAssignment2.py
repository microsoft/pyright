# This sample tests expected diagnostics for augmented assignment
# expressions.


def func1(values1: list[float] = [], values2: list[float] | None = None) -> None:
    values3 = None

    # This should generate an error
    values1 += values2

    if values2 is not None:
        values1 += values2

    # This should generate an error
    values1 -= values2

    # This should generate an error
    values1 += values3
