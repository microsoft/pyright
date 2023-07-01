# This sample tests the detection of static or class method invocations
# where the method is marked abstract.

from abc import ABC, abstractmethod


class A(ABC):
    @staticmethod
    @abstractmethod
    def method1() -> None:
        ...

    @classmethod
    @abstractmethod
    def method2(cls) -> None:
        ...


# This should generate an error.
A.method1()

# This should generate an error.
A.method2()


class B(A):
    @staticmethod
    def method1() -> None:
        # This should generate an error.
        return super().method1()

    @classmethod
    def method2(cls) -> None:
        # This should generate an error.
        return super().method2()


B.method1()
B.method2()


def func1(a: type[A]):
    a.method1()
    a.method2()


class C(A):
    ...


# This should generate an error.
C.method1()

# This should generate an error.
C.method2()
