# This sample tests the handling of default parameter value
# expressions in a lambda.


from typing import Callable, Protocol


def test1():
    var = 1

    lambda _=var: ...


def test2():
    # This should generate an error because var2 isn't defined.
    lambda _=var2: ...


def test3():
    var = 0
    lambda var=var: ...


class MyCallback(Protocol):
    def __call__(self, y: int, a: int = 0) -> bool: ...


lambda1: Callable[[int, int], bool] = lambda y, a=0: a == y
lambda2: MyCallback = lambda y, a=0: a == y

lambda1(20)
lambda2(20)
lambda2(20, 30)
