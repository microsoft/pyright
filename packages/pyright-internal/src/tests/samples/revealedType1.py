# This sample tests the special reveal_type call.

from typing import Union

a: Union[str, int]
if 2 + 3:
    a = 3
else:
    a = "hello"
reveal_type(a)

a = 5
reveal_type(a)

a = "yup"
reveal_type(a)
