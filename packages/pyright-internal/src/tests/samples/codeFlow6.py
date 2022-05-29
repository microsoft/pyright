# This sample tests an interaction between a lambda, a function
# that is declared later in the source, and a function return type
# that uses code flow analysis for evaluation.

from typing import Any, Callable, overload


class C:
    ...


@overload
def func(v: Callable[[], int]) -> int:
    ...


@overload
def func(v: Callable[[], list[C]]) -> list[C]:
    ...


def func(v: Any) -> Any:
    ...


def f(v: list[C]):
    ...


t = func(lambda: second_func())
t.append(C())


def second_func() -> list[C]:
    ...
