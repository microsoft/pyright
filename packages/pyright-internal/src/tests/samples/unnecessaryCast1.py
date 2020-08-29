# This sample tests the type checker's reportUnnecessaryCast feature.

from typing import cast, Union

a: int = 3
# This should generate an error if
# reportUnnecessaryCast is enabled.
b = cast(int, a)

c: Union[int, str] = "hello"
d = cast(int, c)

