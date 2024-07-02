# This sample tests del statements.

# This should generate two errors because x1 and x2 are not defined.
del x1, x2

x1 = 1
del x1

# This should generate an error because x1 isn't defined.
del x1


def func1(y1: int):
    # This should generate an error because y2 is unbound.
    del y1, y2

    # This should generate an error because y1 is unbound.
    del y1

    y2 = 1
    del y2


class ClassA:
    # This should generate an error because z1 is unbound.
    del z1

    z1 = 1
    del z1


class ClassB:
    x: int


b = ClassB()
b.x = 3
reveal_type(b.x, expected_text="Literal[3]")
del b.x
reveal_type(b.x, expected_text="int")

x2: list[str | int] = ["a", 1, "b", 2]
reveal_type(x2[0], expected_text="str | int")
x2[0] = 0
reveal_type(x2[0], expected_text="Literal[0]")
reveal_type(x2[1], expected_text="str | int")
del x2[0]
reveal_type(x2[0], expected_text="str | int")


class ClassC:
    @property
    def x(self) -> str: ...

    @x.setter
    def x(self, value: str) -> None: ...

    @x.deleter
    def x(self) -> None: ...


c = ClassC()
c.x = "x"

reveal_type(c.x, expected_text="Literal['x']")

del c.x
reveal_type(c.x, expected_text="str")
