# This sample tests the detection of static or class method invocations
# where the method is marked abstract.

from abc import ABC, abstractmethod


class A(ABC):
    @staticmethod
    @abstractmethod
    def method1() -> None: ...

    @staticmethod
    @abstractmethod
    def method2() -> None:
        pass

    @classmethod
    @abstractmethod
    def method3(cls) -> None:
        raise NotImplementedError

    @classmethod
    @abstractmethod
    def method4(cls) -> None:
        pass


# This should generate an error.
A.method1()

A.method2()

# This should generate an error.
A.method3()

A.method4()


class B(A):
    @staticmethod
    def method1() -> None:
        # This should generate an error.
        return super(B).method1()

    @staticmethod
    def method2() -> None:
        return super(B).method2()

    @classmethod
    def method3(cls) -> None:
        # This should generate an error.
        return super().method3()

    @classmethod
    def method4(cls) -> None:
        return super().method4()


B.method1()
B.method2()


def func1(a: type[A]):
    a.method1()
    a.method3()


class C(A): ...


# This should generate an error.
C.method1()

# This should generate an error.
C.method3()
