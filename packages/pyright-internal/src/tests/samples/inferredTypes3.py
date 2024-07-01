# This sample tests return type annotations for functions that
# do not return.

from abc import ABC, abstractmethod


class OtherError(NotImplementedError): ...


class A(ABC):
    def func1(self):
        raise Exception("test")

    def func2(self):
        raise NotImplementedError()

    def func3(self):
        raise OtherError

    @abstractmethod
    def func4(self):
        raise Exception()


def func1(a: A):
    reveal_type(a.func1(), expected_text="NoReturn")

    reveal_type(a.func2(), expected_text="Unknown")

    reveal_type(a.func3(), expected_text="Unknown")

    reveal_type(a.func4(), expected_text="Unknown")
