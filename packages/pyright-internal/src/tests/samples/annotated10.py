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


class C:
    value: int = 1

    def method(self) -> int:
        return 1


class D:
    value: int = 2


B = Annotated[C, "meta"]

reveal_type(B.method, expected_text="(self: C) -> int")
B.method(C())

# This should generate an error because no instance is supplied.
B.method()

U = Annotated[C | D, "meta"]

# This should generate an error because a union object has no
# attribute "value".
U.value
