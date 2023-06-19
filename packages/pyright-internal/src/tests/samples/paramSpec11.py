# This sample tests the handling of generic classes that are parameterized
# using a ParamSpec.

from typing import Callable, Generic, TypeVar, ParamSpec


_P = ParamSpec("_P")
_R = TypeVar("_R")


class MyDecorator(Generic[_P, _R]):
    def __init__(self, function: Callable[_P, _R]):
        self.function = function

    def __call__(self, *args: _P.args, **kwargs: _P.kwargs) -> _R:
        print("Inside Function Call")
        return self.function(*args, **kwargs)

    def do_stuff(self, name: str, *args: _P.args, **kwargs: _P.kwargs) -> int:
        return 0


@MyDecorator
def func1(x: int, y: int, *, z: int):
    return x + y


func1(6, 6, z=6)


@MyDecorator
def func2(*, a: int):
    pass


func2.do_stuff("hi", a=4)
