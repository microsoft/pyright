# This sample tests the case where a function-scoped ParamSpec is
# partially specialized through a binding operation.

from typing import Callable, ParamSpec, Self, reveal_type

P = ParamSpec("P")


class A:
    def __init__(self, x: int, y: int, z: str) -> None:
        self.a = x

    # This should generate an error.
    @classmethod
    def f(cls: Callable[P, Self], *args: P.args, **kwargs: P.kwargs) -> int:
        return cls(*args, **kwargs).a


reveal_type(A.f, expected_text="(x: int, y: int, z: str) -> int")
