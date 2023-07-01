# This sample tests the handling of "in" and "not in" operators.


def func1(a: int | str):
    # This should generate an error because a's type doesn't
    # support a __contains__ method.
    if 3 in a:
        pass

    # This should generate an error because a's type doesn't
    # support a __contains__ method.
    if 3 not in a:
        pass


def func(a: list[int] | set[float]):
    if 3 in a:
        pass

    if 3 not in a:
        pass
