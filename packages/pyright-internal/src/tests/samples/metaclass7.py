# This sample tests the case where a metaclass defines a customer
# __call__ method, thus overriding the __new__ method on classes
# that are created from it.

# pyright: reportIncompatibleMethodOverride=false


from typing import Any, Self


class MetaClass1(type):
    def __call__(cls, **kwargs):
        return object.__new__(**kwargs)


class Class1(metaclass=MetaClass1):
    def __new__(cls, *args, **kwargs):
        raise RuntimeError("Cannot instantiate directly")


v1 = Class1()
reveal_type(v1, expected_text="NoReturn")


class MetaClass2(type):
    pass


class Class2(metaclass=MetaClass2):
    def __new__(cls, *args, **kwargs):
        raise RuntimeError("Cannot instantiate directly")


v2 = Class2()
reveal_type(v2, expected_text="NoReturn")


class MetaClass3(type):
    def __call__(cls, *args, **kwargs) -> Any:
        return super().__call__(*args, **kwargs)


class Class3(metaclass=MetaClass3):
    def __new__(cls, *args, **kwargs):
        raise RuntimeError("You cannot instantiate BaseFactory")


v3 = Class3()
reveal_type(v3, expected_text="Any")


class MetaClass4(type):
    def __call__(cls, *args, **kwargs):
        return super().__call__(*args, **kwargs)


class Class4(metaclass=MetaClass4):
    def __new__(cls, *args, **kwargs) -> Self:
        return super().__new__(cls, *args, **kwargs)


v4 = Class4()
reveal_type(v4, expected_text="Class4")
