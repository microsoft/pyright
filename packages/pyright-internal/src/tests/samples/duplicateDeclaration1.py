# This sample tests the detection of duplicate (overwritten) symbols.


from typing import overload


class C:
    # This should generate an error.
    def f(self):
        return 0

    # This should generate an error.
    def f(self):
        return 0

    def f(self):
        return 1

    # This should generate an error.
    def g(self):
        return 0

    g: int

    @property
    def h(self) -> int:
        return 1

    @h.setter
    def h(self, val: int):
        pass

    # This should generate an error.
    @property
    def j(self) -> int:
        return 1

    def j(self) -> int:
        return 3


@overload
def a() -> None:
    ...


@overload
def a(x: int) -> None:
    ...


# This should generate an error.
def a(x: int = 3):
    pass


def a(x: int = 3):
    pass


# This should generate an error.
def b():
    pass


b: int = 3
