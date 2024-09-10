# This sample tests TypeIs when used with a Callable type.

# pyright: reportMissingModuleSource=false

from typing import Callable
from typing_extensions import TypeIs


def is_callable(obj: object, /) -> TypeIs[Callable[..., object]]: ...


def func1(x: type[int]):
    if is_callable(x):
        reveal_type(x, expected_text="type[int]")
    else:
        reveal_type(x, expected_text="Never")


def func2[T](x: type[T]):
    if is_callable(x):
        reveal_type(x, expected_text="type[T@func2]")
    else:
        reveal_type(x, expected_text="Never")


def func3[T](x: type[T] | T):
    if is_callable(x):
        reveal_type(x, expected_text="type[T@func3] | ((...) -> object)")
    else:
        reveal_type(x, expected_text="object*")


def func4[T](x: T) -> T:
    if not is_callable(x):
        reveal_type(x, expected_text="object*")
        raise ValueError()
    reveal_type(x, expected_text="(...) -> object")
    return x
