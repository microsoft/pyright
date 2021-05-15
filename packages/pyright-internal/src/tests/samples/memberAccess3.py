# This sample tests instance and class variable type inference when
# the type can't be inferred from the class itself and must use
# the parent class.


from typing import Generic, TypeVar


class A:
    pi = 3.1415

    def __init__(self):
        self.x = 1


class B(A):
    def __init__(self):
        self.y = "hi"


class C(B):
    def method1(self):
        a = self.x
        require_int(a)

        # This should generate an error because a should be an int
        require_str(a)

        b = self.y
        require_str(b)

        # This should generate an error because b should be an str
        require_int(b)

        c = self.pi
        require_float(c)

        # This should generate an error because c should be a float
        require_int(c)


def require_int(val: int):
    pass


def require_str(val: str):
    pass


def require_float(val: float):
    pass


_TParent = TypeVar("_TParent")
_TChild = TypeVar("_TChild")


class Parent(Generic[_TParent]):
    member1: _TParent


class Child(Parent[_TChild]):
    def __init__(self, val: _TChild):
        self.member1 = val
