# This sample tests the type checker's reportUnnecessaryCast feature.

from typing import cast, Union


def foo(a: int):
    # This should generate an error if
    # reportUnnecessaryCast is enabled.
    b = cast(int, a)


c: Union[int, str] = "hello"
d = cast(int, c)
