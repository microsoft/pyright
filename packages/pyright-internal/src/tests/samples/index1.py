# This sample tests the handling of __index__ magic method
# when used with the __getitem__ and __setitem__ method.


from typing import Generic, Literal, Self, Type, TypeVar, Any


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
reveal_type(a1, expected_text="ClassA")

# This should generate an error
ClassA["1"]


class ClassB:
    def __setitem__(self, index: int, value: "ClassB"): ...


class ClassC:
    def __setitem__(self, index: int, value: "ClassC"): ...


B_or_C = TypeVar("B_or_C", ClassB, ClassC)


def func1(container: B_or_C):
    a = container
    a[1] = container


TD = TypeVar("TD", bound="ClassD[Any]")


class ClassD(Generic[TD]):
    def __setitem__(self, index: int, value: TD): ...


def func2(container: ClassD[TD], value: TD):
    container[1] = value


class ClassE:
    def __getattr__(self, s: str) -> Any:
        raise NotImplementedError()


e = ClassE()

# This should generate an error
v_e = e["test"]

# This should generate an error
e["test"] = 3


class ClassF(Generic[T]):
    def __getitem__(self, args: int) -> Self: ...

    def get(self, index: int) -> Self:
        reveal_type(self[index], expected_text="Self@ClassF[T@ClassF]")
        return self[index]


class ClassG:
    __slots__ = ["x"]


def func3(g: ClassG):
    reveal_type(g.x, expected_text="Unbound")
    reveal_type(g.x[0], expected_text="Unknown")


class ClassH:
    def __call__(self, *args, **kwargs) -> Self:
        return self


class ClassI:
    __getitem__ = ClassH()


reveal_type(ClassI()[0], expected_text="ClassH")


def func4(l: list[Literal["a", "b"]]):
    l[0] = "a"
    l[0:0] = ["a", "b"]
