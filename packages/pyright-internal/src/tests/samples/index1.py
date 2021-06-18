# This sample tests the handling of __index__ magic method
# when used with the __getitem__ and __setitem__ method.


from typing import Generic, Literal, Type, TypeVar, Any


class MyInt:
    def __init__(self, value: int) -> None:
        self.value = value

    def __index__(self) -> int:
        return self.value


l = ["foo", "bar"]
t = ("foo", "bar")

hex(MyInt(7))
l[MyInt(0)]
l[MyInt(0)] = "hi"
t[MyInt(1)]


class MyNonInt:
    def __init__(self) -> None:
        pass


# These should generate errors
hex(MyNonInt())
l[MyNonInt()]
l[MyNonInt()] = "hi"
t[MyNonInt()]


T = TypeVar("T")


class MyMetaclass(type):
    def __getitem__(cls: Type[T], item: int) -> T:
        return cls()


class ClassA(metaclass=MyMetaclass):
    pass


a1 = ClassA[1]
t_a1: Literal["ClassA"] = reveal_type(a1)

# This should generate an error
ClassA["1"]


class ClassB:
    def __setitem__(self, index: int, value: "ClassB"):
        ...


class ClassC:
    def __setitem__(self, index: int, value: "ClassC"):
        ...


B_or_C = TypeVar("B_or_C", ClassB, ClassC)


def func1(container: B_or_C):
    a = container
    a[1] = container


TD = TypeVar("TD", bound="ClassD[Any]")


class ClassD(Generic[TD]):
    def __setitem__(self, index: int, value: TD):
        ...


def func2(container: ClassD[TD], value: TD):
    container[1] = value
