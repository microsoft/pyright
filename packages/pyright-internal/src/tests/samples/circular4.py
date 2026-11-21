# This sample tests the inferred type of an inherited instance
# variable whose value depends on a call to a method that accesses
# that variable.


class A:
    def __init__(self) -> None:
        self.x = func1(False) or [1]


class B(A):
    def method1(self):
        self.x += []
        return self.x


def func1(flag: bool):
    if flag:
        return B().method1()
    return None


reveal_type(B.method1, expected_text="(self: B) -> (Unknown | list[int])")
reveal_type(func1, expected_text="(flag: bool) -> (Unknown | list[int] | None)")
