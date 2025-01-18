# This sample tests the handling of a "bare" ClassVar with no
# subscript.

from typing import ClassVar


class A:
    a: ClassVar
    b: ClassVar = 2
    c: ClassVar
    d: ClassVar

    d = 3

    @classmethod
    def m1(cls) -> None:
        cls.c = ""


reveal_type(A.a, expected_text="Unknown")
A.a = 3
A.a = ""

reveal_type(A.b, expected_text="int")
A.b = 2

# This should generate an error
A.b = ""

reveal_type(A.c, expected_text="Unknown")
A.c = 2
A.c = ""

reveal_type(A.d, expected_text="int")
A.d = 2

# This should generate an error
A.d = ""
