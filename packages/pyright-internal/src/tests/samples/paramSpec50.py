# This sample tests the case where a ParamSpec captures another ParamSpec.

from typing import Callable, Iterator, ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")


def deco1(func: Callable[P, Iterator[T]]) -> Callable[P, Iterator[T]]: ...


@deco1
def func1(
    func: Callable[P, str],
    *func_args: P.args,
    **func_kwargs: P.kwargs,
) -> Iterator[str]: ...


def func2(a: int, b: float) -> str: ...


def func3(a: int) -> str: ...


func1(func2, 3, 1.1)

# This should generate an error.
func1(func2, 3.1, 1.1)

func1(func3, 3)

# This should generate an error.
func1(func3)
