# This sample tests the handling of ParamSpec when used with
# static methods and class methods.

from typing import Callable
from typing_extensions import ParamSpec

P = ParamSpec("P")


def rounder(func: Callable[P, float]) -> Callable[P, int]:
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> int:
        return round(func(*args, **kwargs))

    return wrapper


class Foo:
    @rounder
    @classmethod
    def identity_cls(cls, val: float) -> float:
        return val

    @rounder
    @staticmethod
    def identity_static(val: float) -> float:
        return val


reveal_type(Foo.identity_cls(1.2), expected_text="int")
reveal_type(Foo.identity_static(1.2), expected_text="int")
