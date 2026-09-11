# This sample tests member access on an Annotated alias used as a value.

from typing import Annotated, ClassVar

class Foo:
    bar: int = 42
    baz: ClassVar[str] = "hello"

A = Annotated[Foo, "meta"]

reveal_type(A.bar, expected_text="int")
reveal_type(A.baz, expected_text="str")

def f(x: A) -> int:
    reveal_type(x.bar, expected_text="int")
    return x.bar
