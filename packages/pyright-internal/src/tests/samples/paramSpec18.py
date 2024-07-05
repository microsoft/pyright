# This sample tests the handling of a ParamSpec within a callback protocol.

from typing import Callable, Concatenate, ParamSpec, Protocol


P = ParamSpec("P")


def callback(a: int, b: str, c: str) -> int: ...


CallableWithConcatenate = Callable[Concatenate[int, P], int]


def func_with_callable(cb: CallableWithConcatenate[P]) -> Callable[P, bool]: ...


x1 = func_with_callable(callback)
reveal_type(x1, expected_text="(b: str, c: str) -> bool")


class ClassWithConcatenate(Protocol[P]):
    def __call__(self, x: int, /, *args: P.args, **kwargs: P.kwargs) -> int: ...


def func_with_protocol(cb: ClassWithConcatenate[P]) -> Callable[P, bool]: ...


x2 = func_with_protocol(callback)
reveal_type(x2, expected_text="(b: str, c: str) -> bool")


class CallbackPos(Protocol[P]):
    def __call__(self, /, *args: P.args, **kwargs: P.kwargs) -> None: ...


def invoke_pos(cb: CallbackPos[P], /, *args: P.args, **kwargs: P.kwargs) -> None:
    cb(*args, **kwargs)
