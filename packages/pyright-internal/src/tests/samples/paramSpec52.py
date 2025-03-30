# This sample tests an illegal use of a ParamSpec that resulted in
# a crash.

from typing import Callable, Generic, ParamSpec

P = ParamSpec("P")


class A(Generic[P]):
    def __call__(self, a: int, b: int, *args: P.args, **kwargs: P.kwargs) -> None: ...


class B:
    # This should generate an error.
    x: A[P]


# This should generate an error, not crash.
B().x(1)
