# This sample tests the case where a generic class uses a default argument
# for a generic type parameter in its constructor.

from typing import Callable, Generic, List, TypeVar


T = TypeVar("T")
U = TypeVar("U")


class Box(Generic[T]):
    def __init__(self, value: T = 123):
        self.value = value


x1 = Box[str | int]()
x2 = Box[float]()
x3 = Box[str]("hi")

# This should generate an error because "hi" isn't compatible
# with float.
x4 = Box[float]("hi")


# This should generate an error because the default value of 123
# isn't compatible with str.
y = Box[str]()


class Container(Generic[T]):
    def __init__(self, value: T = None):
        self.value = value

    @classmethod
    def create(cls) -> "Container[T]":
        # This should generate an error if strictParameterNoneValue
        # is true because Container[T] being constructed is different
        # from the current Container[T].
        return Container[T]()

    def on_next(self, value: T):
        pass


class IntContainer(Container[int]):
    def increment(self):
        # This should generate an error if strictParameterNoneValue is false.
        self.value += 1


class ContainerList(Generic[U]):
    def __init__(self) -> None:
        self.containers: List[Container[U]] = []

    def method1(self, a: U):
        Container[U](a)
        Container()
        Container(123)

        # This should generate an error if strictParameterNoneValue is true.
        Container[U]()

        # This should generate an error if strictParameterNoneValue is true.
        Container[U](None)

    def method2(self):
        Container[U].create()


def func1(obv: Container[T], default_value: T = None) -> None:
    # This should generate an error if strictParameterNoneValue is false.
    obv.on_next(default_value)


class A: ...


T_A = TypeVar("T_A", bound=A)


class B(Generic[T]):
    def __init__(self, c: Callable[[], T]): ...


def func2(cls: type[T_A] = A) -> Callable[[], T_A]: ...


B(func2())
