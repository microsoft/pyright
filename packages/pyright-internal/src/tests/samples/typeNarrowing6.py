# This sample verifies that a member access expression whose type
# is narrowed is "reset" when part of the member access expression
# is reassigned.


class Foo1:
    val0: int


class Foo2:
    val1: int
    val2: Foo1


def func(a: bool):
    foo2: Foo2 = Foo2()
    foo2.val1 = 0
    foo2.val2.val0 = 4

    reveal_type(foo2.val1, expected_text="Literal[0]")
    reveal_type(foo2.val2.val0, expected_text="Literal[4]")

    if a:
        foo2 = Foo2()

    reveal_type(foo2.val1, expected_text="int")
    reveal_type(foo2.val2.val0, expected_text="int")
