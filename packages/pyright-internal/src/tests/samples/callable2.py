# This sample tests the assignment of callables
# that include type variables in the parameter and
# return types.

from typing import Any, Callable, Iterable, Sequence, TypeVar


_T = TypeVar("_T")


def my_min(__iterable: Iterable[_T]) -> _T:
    ...


a: Callable[[Sequence[float]], float] = my_min
b: Callable[[Sequence[Any]], Any] = my_min

_S = TypeVar("_S", bound=float)


def my_max(__iterable: Iterable[_S]) -> _S:
    ...


c: Callable[[Sequence[int]], int] = my_max

# This should generate an error because Sequence[str]
# is not compatible with the bound TypeVar _S.
d: Callable[[Sequence[str]], Any] = my_max
