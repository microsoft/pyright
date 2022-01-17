# This sample tests the special reveal_type call.

from typing import Literal, Union

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


reveal_type(a, expected_type=Literal["yup"])
reveal_type(a, expected_text="Literal['yup']")
reveal_type(a, expected_text="Literal['yup']", expected_type=Literal["yup"])

# This should generate an error.
reveal_type()

# This should generate an error.
reveal_type(a, a)


reveal_type(a, x=3)
