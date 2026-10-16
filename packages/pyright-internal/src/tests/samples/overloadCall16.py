from collections.abc import Callable
from typing import assert_type, overload


@overload
def choose(callback: Callable[..., int]) -> int: ...


@overload
def choose(callback: Callable[[str], object]) -> object: ...


def choose(callback: Callable[..., object]) -> object:
    return 1


assert_type(choose(lambda unused: 1), int)
