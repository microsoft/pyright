# This sample tests a complex overload case that was causing a hang
# in pyright's logic.

from typing import Callable, overload


@overload
def func1[K, VI, VO](d: dict[K, VI], func: Callable[[VI], VO]) -> dict[K, VO]: ...


@overload
def func1[K, VI, VO](d: VI, func: Callable[[VI], VO]) -> VO: ...


def func1[K, VI, VO](
    d: dict[K, VI] | VI, func: Callable[[VI], VO]
) -> dict[K, VO] | VO: ...
