# This sample tests the handling of the "super" call when
# used with a two-argument form that specifies the "bind to" type.

from typing import TypeVar

T = TypeVar("T", bound="A")


class A:
    def __init__(self, **kw: object) -> None:
        pass

    @classmethod
    def factoryA(cls: type[T]) -> T:
        return cls()

    @classmethod
    def get(cls: type[T], key: str) -> T:
        return cls()


class B(A):
    @classmethod
    def factoryB(cls):
        return super(B, cls).factoryA()

    @classmethod
    def get(cls, key: str = ""):
        return super(B, cls).get(key)


class BChild(B):
    pass


a1 = A.factoryA()
reveal_type(a1, expected_text="A")

b1 = B.factoryA()
reveal_type(b1, expected_text="B")

b2 = B.factoryB()
reveal_type(b2, expected_text="B")

g1 = B.get()
reveal_type(g1, expected_text="B")

g2 = BChild.get()
reveal_type(g2, expected_text="BChild")


def test_a(cls: type[T]) -> T:
    return super(A, cls).__new__(cls)


class C:
    def __init__(self) -> None: ...


class CChild(C):
    def __init__(self, name: str) -> None: ...


class D:
    def __init__(self, name: str, num: int): ...


class DChild1(CChild, D):
    def __init__(self, name: str, num: int) -> None:
        super(C, self).__init__(name, num)


class DChild2(CChild, D):
    def __init__(self, name: str) -> None:
        super(DChild2, self).__init__(name)


class DChild3(CChild, D):
    def __init__(self) -> None:
        super(CChild, self).__init__()


d1 = DChild1("", 1)
d2 = DChild2("")
d3 = DChild3()


class E:
    def __new__(cls) -> "E":
        return super(type, cls).__new__(cls)


class F: ...


class FChild1(F): ...


def func1(cls: type[F | FChild1]):
    super(F, cls)
