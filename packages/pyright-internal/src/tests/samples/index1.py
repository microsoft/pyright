# This sample tests the handling of __index__ magic method
# when used with the __getitem__ and __setitem__ method.


class MyInt:
    def __init__(self, value: int) -> None:
        self.value = value

    def __index__(self) -> int:
        return self.value


l = ["foo", "bar"]
t = ("foo", "bar")

hex(MyInt(7))
l[MyInt(0)]
l[MyInt(0)] = "hi"
t[MyInt(1)]


class MyNonInt:
    def __init__(self) -> None:
        pass


# These should generate errors
hex(MyNonInt())
l[MyNonInt()]
l[MyNonInt()] = "hi"
t[MyNonInt()]
