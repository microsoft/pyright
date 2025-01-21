# This sample tests the case where an argument to a constructor
# uses an assignment expression (walrus operator) and the constructor
# has both a __new__ and __init__ method whose parameters have
# different bidirectional type inference contexts.

from typing import Any, Self


class A:
    def __new__(cls, *args: Any, **kwargs: Any) -> Self: ...
    def __init__(self, base: list[str], joined: str) -> None: ...


A(temp := ["x"], " ".join(temp))
