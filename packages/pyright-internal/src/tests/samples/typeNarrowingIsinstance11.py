# This sample tests the case where the class type passed as the second
# argument to isinstance is incomplete the first time the type guard
# is evaluated because it's in an loop.


class X:
    pass


class Y:
    p: type


def func1(xs: list[X | Y]) -> None:
    for x in xs:
        if not isinstance(x, X):
            if x.p == X:
                pass
