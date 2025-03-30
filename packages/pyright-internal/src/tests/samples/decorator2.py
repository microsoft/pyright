# This sample tests the usage of overloads in decorators.

from typing import Callable, TypeVar, overload, Optional, Union

F = TypeVar("F", bound=Callable[[], None])


@overload
def atomic(__func: F) -> F: ...


@overload
def atomic(*, savepoint: bool = True) -> Callable[[F], F]: ...


def atomic(
    __func: Optional[Callable[..., None]] = None, *, savepoint: bool = True
) -> Union[Callable[[], None], Callable[[F], F]]: ...


@atomic
def func1() -> None: ...


@atomic(savepoint=False)
def func2() -> None: ...
