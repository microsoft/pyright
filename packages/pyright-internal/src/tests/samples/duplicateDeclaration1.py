# This sample tests the detection of duplicate (overwritten) symbols.


from typing import Callable, overload


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
def a() -> None: ...


@overload
def a(x: int) -> None: ...


# This should generate an error.
def a(x: int = 3):
    pass


def a(x: int = 3):
    pass


# This should generate an error.
def b():
    pass


b: int = 3


def func1(cond: bool):
    if cond:

        def a() -> int:
            return 3

        # This should generate an error because its inferred return
        # type differs from b above.
        def b():
            return 3

        # This should generate an error because the parameter names don't match.
        def c(a: int, b: str) -> None:
            return None

        # This should generate an error because the parameter is positional-only.
        def d(a: int) -> None:
            return None

        def e(a: int, /) -> None:
            return None

        # This should generate an error because the parameter is not positional-only.
        f: Callable[[int], None] = lambda a: None

        g: Callable[[int], None] = lambda a: None

    else:

        def a() -> int:
            return 2

        def b():
            return 2

        def c(a: int, c: str) -> None:
            return None

        d: Callable[[int], None] = lambda a: None

        e: Callable[[int], None] = lambda a: None

        def f(a: int) -> None:
            return None

        def g(a: int, /) -> None:
            return None
