# This sample tests the detection and reporting of unreachable code.

import os
import sys
from abc import abstractmethod
from typing import NoReturn


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

    def method5(self) -> NoReturn:
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


def func8() -> NoReturn:
    raise NameError()


def func9():
    func8()

    # This should be marked unreachable.
    return 3


def func10():
    e = OSError()
    a1 = os.name == "nt" and None == e.errno
    reveal_type(a1, expected_text="bool")

    a2 = True and os.name == "nt"
    reveal_type(a2, expected_text="bool")

    if os.name == "nt":
        # This should be marked unreachable.
        b = e.errno

    if sys.version_info >= (4, 0):
        # This should be marked unreachable.
        b = e.errno

    return
    # This should be marked unreachable.
    b = e.errno


def func11(obj: str) -> list:
    if isinstance(obj, str):
        return []
    else:
        # This should be marked as unreachable.
        return obj


def func12(obj: str) -> list:
    if isinstance(obj, str):
        return []

    # This should be marked as unreachable.
    return obj
