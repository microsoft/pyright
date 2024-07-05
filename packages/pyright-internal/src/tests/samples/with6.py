# This sample tests that classes whose metaclass implements a context
# manager work with the "with" statement.

from types import TracebackType


class ClassA(type):
    def __enter__(cls) -> "ClassA":
        print("Enter A")
        return cls

    def __exit__(
        cls, exc_typ: type[Exception], exc_val: Exception, exc_tbc: TracebackType
    ) -> None:
        print("Exit A")


class ClassB(metaclass=ClassA): ...


with ClassB as b:
    ...
