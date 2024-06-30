# This sample tests the detection of a runtime checkable protocol
# that unsafely overlaps a class within an isinstance or issubclass
# call.

# > Type checkers should reject an isinstance() or issubclass() call if there
# > is an unsafe overlap between the type of the first argument and the protocol.


from typing import Protocol, runtime_checkable


@runtime_checkable
class Proto3(Protocol):
    def method1(self, a: int) -> int: ...


class Concrete3A:
    def method1(self, a: str) -> None:
        pass


@runtime_checkable
class Proto2(Protocol):
    def other(self) -> None: ...


class Concrete3B:
    method1: int = 1


def func3():
    if isinstance(Concrete3A(), Proto3):  # Type error: unsafe overlap
        pass

    if isinstance(Concrete3B(), (Proto3, Proto2)):  # Type error: unsafe overlap
        pass

    if issubclass(Concrete3A, (Proto3, Proto2)):  # Type error: unsafe overlap
        pass
