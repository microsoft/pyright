# This sample tests the case where a class defines a __new__ method
# that returns a class other than the owning class.


class A:
    def __init__(self) -> None:
        pass


class B(A):
    def __new__(cls) -> A:
        return A()

    def __init__(self, a: int) -> None:
        pass


class C(B):
    def __init__(self, a: int) -> None:
        pass


B()

# This should generate an error because B.__init__ is never called.
B(1)

C()

# This should generate an error because C.__init__ is never called.
C(1)
