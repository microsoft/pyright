# This sample tests a complicated combination of ParamSpec usage.

# pyright: strict

from typing import Callable, TypeVar, overload
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Concatenate,
    ParamSpec,
)

_T = TypeVar("_T")
_R = TypeVar("_R")
_P = ParamSpec("_P")


@overload
def error_decorator(
    error_codes: None = None,
) -> Callable[
    [Callable[Concatenate[_T, _P], _R]], Callable[Concatenate[_T, _P], _R]
]: ...


@overload
def error_decorator(
    error_codes: list[str],
) -> Callable[
    [Callable[Concatenate[_T, _P], _R]], Callable[Concatenate[_T, _P], _R | None]
]: ...


def error_decorator(
    error_codes: list[str] | None = None,
) -> Callable[
    [Callable[Concatenate[_T, _P], _R]], Callable[Concatenate[_T, _P], _R | None]
]:
    """Filter specific errors and raise custom exception for remaining once."""

    def decorator(
        func: Callable[Concatenate[_T, _P], _R],
    ) -> Callable[Concatenate[_T, _P], _R | None]:
        def wrapper(self: _T, *args: _P.args, **kwargs: _P.kwargs) -> _R | None:
            try:
                return func(self, *args, **kwargs)
            except Exception as ex:
                if error_codes is not None:
                    return None
                raise Exception("Custom exception") from ex

        return wrapper

    return decorator
