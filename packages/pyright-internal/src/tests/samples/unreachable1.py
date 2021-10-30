# This sample tests the detection and reporting of unreachable code.

from abc import abstractmethod


def func1():
    """
    Docstring
    """
    raise NotImplementedError()


class Foo:
    b: bool

    @staticmethod
    def method1():
        """
        Docstring
        """
        raise NotImplementedError("Not Implemented")

    def method2(self, a: int):
        """
        Docstring
        """
        if a < 10 or self.b:
            raise NotImplementedError()

    @abstractmethod
    def method3(self):
        print(self.b)
        raise RuntimeError()

    def method4(self) -> None:
        print(self.b)
        raise RuntimeError()

    def method5(self):
        print(self.b)
        raise RuntimeError()


def func2():
    func1()

    # This should not be marked unreachable because NotImplementedError
    # is special-cased.
    return 3


def func3(foo: Foo):
    foo.method1()
    return 3


def func4(foo: Foo):
    foo.method2(2)
    return 3


def func5(foo: Foo):
    foo.method3()
    return 3


def func6(foo: Foo):
    foo.method4()
    return 3


def func7(foo: Foo):
    foo.method5()

    # This should be marked as unreachable
    return 3


def func8():
    raise NameError()


def func9():
    func8()

    # This should be marked unreachable.
    return 3
