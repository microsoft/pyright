# This sample tests an interaction between a lambda, a function
# that is declared later in the source, and a function return type
# that uses code flow analysis for evaluation.

from typing import Any, Callable, overload


class C: ...


@overload
def func1(v: Callable[[], int]) -> int: ...


@overload
def func1(v: Callable[[], list[C]]) -> list[C]: ...


def func1(v: Any) -> Any: ...


def func2(v: list[C]): ...


t = func1(lambda: func3())
t.append(C())


def func3() -> list[C]: ...
