# This sample tests the type checker's reoprtUnnecessaryCast feature.

from typing import cast, Union

a = 3
# This should generate an error if
# reportUnneessaryCast is enabled.
b = cast(int, a)

c: Union[int, str] = 'hello'
d = cast(int, c)




