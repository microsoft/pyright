# This sample verifies that a member access expression whose type
# is narrowed is "reset" when part of the member access expression
# is reassigned.

from typing import Literal


class Foo1:
    val0: int


class Foo2:
    val1: int
    val2: Foo1


def func(a: bool):
    foo2: Foo2 = Foo2()
    foo2.val1 = 0
    foo2.val2.val0 = 4

    t1: Literal["Literal[0]"] = reveal_type(foo2.val1)
    t2: Literal["Literal[4]"] = reveal_type(foo2.val2.val0)

    if a:
        foo2 = Foo2()

    t3: Literal["int"] = reveal_type(foo2.val1)
    t4: Literal["int"] = reveal_type(foo2.val2.val0)
