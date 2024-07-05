# This sample tests a complicated combination of ParamSpec usage.

# pyright: strict

from typing import Any, Callable, Concatenate, ParamSpec, Protocol, TypeVar


_Fn = TypeVar("_Fn", bound=Callable[..., Any])
_Ret = TypeVar("_Ret")
_Args = ParamSpec("_Args")
_Self = TypeVar("_Self", bound="_GenerativeType")


def decorator(
    target: Callable[Concatenate[_Fn, _Args], _Ret],
) -> Callable[[_Fn], Callable[_Args, _Ret]]: ...


class _GenerativeType(Protocol):
    def _generate(self: "_Self") -> "_Self": ...


def generative(
    fn: Callable[Concatenate[_Self, _Args], None],
) -> Callable[Concatenate[_Self, _Args], _Self]:
    @decorator
    def _generative(
        fn: Callable[Concatenate[_Self, _Args], None],
        self: _Self,
        *args: _Args.args,
        **kw: _Args.kwargs,
    ) -> _Self: ...

    decorated = _generative(fn)

    return decorated
