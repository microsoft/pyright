# This sample tests the type analyzer's handling of the super() call.


from typing import Generic, NamedTuple, TypeVar

T = TypeVar("T")


class ClassA:
    @staticmethod
    def method1():
        pass

    def method5(self) -> type:
        return ClassA


class ClassB(ClassA):
    def __init__(self):
        pass

    def method2(self):
        pass


class ClassC(ClassA):
    def __init__(self):
        pass

    def method3(self):
        return self.__class__()

    @staticmethod
    def aaa():
        # This should generate an error because the zero-arg form
        # of super is illegal in a static method.
        super().method1()


class ClassD(ClassB, ClassC):
    def __init__(self):
        super().method2()
        super().method3()

        # This should generate an error
        super().non_method1()

    def method(self):
        def inner1():
            # This should generate an error because the frame that executes
            # the zero-arg form of super receives no first argument.
            super().method1()

        def inner2(obj):
            # This is allowed because the frame receives a first argument,
            # so `inner2(self)` succeeds at runtime.
            super().method1()

        def inner3(value=super().method1()):
            # Parameter default values are evaluated in the enclosing
            # method's frame, so this is allowed.
            pass

        async def inner4():
            # This should generate an error because the frame that executes
            # the zero-arg form of super receives no first argument.
            super().method1()

        async def inner5(obj):
            # This is allowed because the frame receives a first argument.
            super().method1()

        # This should generate an error because a lambda with no parameters
        # receives no first argument.
        lambda: super().method1()

        # This is allowed because the lambda receives a first argument.
        lambda obj: super().method1()

        # As of Python 3.12, list, set, and dict comprehensions are inlined
        # into the enclosing frame, so these are allowed.
        [super().method1() for _ in [1]]
        {super().method1() for _ in [1]}
        {0: super().method1() for _ in [1]}

        # This should generate an error because a generator expression always
        # executes in its own frame whose first argument is the iterator.
        list(super().method1() for _ in [1])


super(ClassD)

# This should generate an error
super(ClassD).non_method2()


super(ClassB, ClassD).method1()

# This should generate an error because Foo2
# is not a subclass of Foo1.
super(ClassB, ClassC).method1()

v1 = ClassD()
super(ClassB, v1).method1()

v2 = ClassC()
# This should generate an error because Foo2
# is not a subclass of Foo1.
super(ClassB, v2).method1()


class ClassE(ClassA):
    def method5(self):
        class ClassDInner(super().method5()):
            # This should generate an error.
            x = super().method5()

        return ClassDInner


class ClassF(Generic[T]):
    def __init__(self, val: T):
        pass


class ClassG(ClassF[T]):
    def __init__(self, val: T) -> None:
        super().__init__(val)


class ClassH(NamedTuple("NT1", [("y", int), ("x", int)])):
    def method(self, v: tuple[int, int]):
        cls = type(self)
        v = super().__new__(cls, *v)
        return type(self)(self.y + v.y, self.x + v.x)
