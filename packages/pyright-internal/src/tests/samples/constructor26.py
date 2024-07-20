# This sample tests the case where a generic class with multiple
# type parameters invokes its own constructor and uses its own
# type parameters to specialize the constructed type.

from typing import Generic, TypeVar

T = TypeVar("T")
U = TypeVar("U")


class Test1(Generic[T, U]):
    def __init__(self, t: T, u: U):
        pass

    def test1(self, ts: list[T], us: list[U]) -> None:
        # This should generate an error.
        x1: Test1[U, T] = Test1(us, ts)

        x2: Test1[list[U], list[T]] = Test1(us, ts)


class Test2(Generic[T, U]):
    def __init__(self):
        pass

    def test2(self) -> None:
        x1: Test2[U, T]
        x2: Test2[T, T]
        x3: Test2[T, U]

        x1 = Test2[U, T]()
        # This should generate an error.
        x2 = Test2[U, T]()
        # This should generate an error.
        x3 = Test2[U, T]()

        # This should generate an error.
        x1 = Test2[T, T]()
        x2 = Test2[T, T]()
        # This should generate an error.
        x3 = Test2[T, T]()

        # This should generate an error.
        x1 = Test2[T, U]()
        # This should generate an error.
        x2 = Test2[T, U]()
        x3 = Test2[T, U]()


class Test3(Generic[T, U]):
    def __init__(self, ts: list[T], us: list[U]):
        pass

    def test3(self, ts: list[T], us: list[U]) -> None:
        x1: Test3[U, T] = Test3(us, ts)

        # This should generate two errors.
        x2: Test3[list[U], list[T]] = Test3(us, ts)
