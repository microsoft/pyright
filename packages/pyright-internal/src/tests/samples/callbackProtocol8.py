# This sample tests the case where a callback protocol contains an *args
# and some keyword parameters.

from typing import Any, Protocol


class P(Protocol):
    def __call__(self, *args: Any, kwarg0: Any, kwarg1: Any) -> None: ...


def f(*args: Any, kwarg0: Any, kwarg1: Any) -> None: ...


p: P = f
