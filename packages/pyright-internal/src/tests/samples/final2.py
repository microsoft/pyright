# This sample tests the handling of the @final method decorator.

from typing import Any, cast, final, overload


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

    @overload
    def func7(self, x: int) -> int: ...

    @overload
    def func7(self, x: str) -> str: ...

    @final
    def func7(self, x: int | str) -> int | str: ...

    # This should generate an error because the implementation
    # of func8 is marked as not final but this overload is.
    @overload
    @final
    def func8(self, x: int) -> int: ...

    @overload
    def func8(self, x: str) -> str: ...

    def func8(self, x: int | str) -> int | str: ...

    @final
    @property
    def prop1(self) -> int: ...

    @property
    @final
    def prop2(self) -> int: ...

    @property
    def prop3(self) -> int: ...

    @prop3.setter
    @final
    def prop3(self, value: int) -> None: ...


# This should generate an error because func3 is final.
ClassA.func3 = lambda self: None

# This should generate an error because func4 is final.
ClassA.func4 = lambda cls: None

# This should generate an error because _func5 is final.
ClassA._func5 = lambda self: None

# This should generate an error because func7 is final.
ClassA.func7 = cast(Any, lambda self, x: "")


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

    @overload
    def func7(self, x: int) -> int: ...

    @overload
    def func7(self, x: str) -> str: ...

    @final
    # This should generate an error because func7 is
    # defined as final.
    def func7(self, x: int | str) -> int | str: ...

    # This should generate an error because prop1 is
    # defined as final.
    @property
    def prop1(self) -> int: ...

    # This should generate an error because prop2 is
    # defined as final.
    @property
    def prop2(self) -> int: ...

    @property
    def prop3(self) -> int: ...

    # This should generate an error because prop3's setter is
    # defined as final.
    @prop3.setter
    @final
    def prop3(self, value: int) -> None: ...


class Base4: ...


class Base5:
    @final
    def __init__(self, v: int) -> None: ...


class C(Base4, Base5):
    # This should generate an error because it overrides Base5,
    # and __init__ is marked final there.
    def __init__(self) -> None: ...


# This should generate an error because @final isn't allowed on
# non-method functions.
@final
def func1():
    return None
