# This sample tests the type analyzer's handling of the super() call.


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


class Bar(ClassB, ClassC):
    def __init__(self):
        super().method2()
        super().method3()

        # This should generate an error
        super().non_method1()

    def method(self):
        def inner():
            super().method1()


super(Bar)

# This should generate an error
super(Bar).non_method2()


super(ClassB, Bar).method1()

# This should generate an error because Foo2
# is not a subclass of Foo1.
super(ClassB, ClassC).method1()

v1 = Bar()
super(ClassB, v1).method1()

v2 = ClassC()
# This should generate an error because Foo2
# is not a subclass of Foo1.
super(ClassB, v2).method1()


class ClassD(ClassA):
    def method5(self):
        class ClassDInner(super().method5()):
            # This should generate an error.
            x = super().method5()

        return ClassDInner
