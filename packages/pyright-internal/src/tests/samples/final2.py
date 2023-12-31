# This sample tests the handling of the @final method decorator.

from typing import final


class ClassA:
    def func1(self):
        pass

    @classmethod
    def func2(cls):
        pass

    @final
    def func3(self):
        pass

    @final
    @classmethod
    def func4(cls):
        pass

    @final
    def _func5(self):
        pass

    @final
    def __func6(self):
        pass


# This should generate an error because func3 is final.
ClassA.func3 = lambda self: None

# This should generate an error because func4 is final.
ClassA.func4 = lambda cls: None

# This should generate an error because _func5 is final.
ClassA._func5 = lambda self: None


class ClassB(ClassA):
    def func1(self):
        # This should generate an error because @final isn't allowed
        # on non-method functions.
        @final
        def func1_inner():
            pass
        

    @classmethod
    def func2(cls):
        pass

    # This should generate an error because func3 is
    # defined as final.
    def func3(self):
        pass

    # This should generate an error because func3 is
    # defined as final.
    @classmethod
    def func4(cls):
        pass

    # This should generate an error because func3 is
    # defined as final.
    def _func5(self):
        pass

    # This should not generate an error because double
    # underscore symbols are exempt from this check.
    def __func6(self):
        pass


class Base4:
    ...


class Base5:
    @final
    def __init__(self, v: int) -> None:
        ...


class C(Base4, Base5):
    # This should generate an error because it overrides Base5,
    # and __init__ is marked final there.
    def __init__(self) -> None:
        ...


# This should generate an error because @final isn't allowed on
# non-method functions.
@final
def func1():
    return None
