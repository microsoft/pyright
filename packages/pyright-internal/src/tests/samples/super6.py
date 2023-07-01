# This sample tests the case where super().__new__(cls) is called
# and there is an inferred return type based on the cls type.

from typing import NamedTuple

FooBase = NamedTuple("FooBase", [("x", int)])


class Foo(FooBase):
    def __new__(cls):
        obj = super().__new__(cls, x=1)
        reveal_type(obj, expected_text="Self@Foo")
        return obj


f = Foo()
reveal_type(f, expected_text="Foo")


class FirstLevelMeta(type):
    def __new__(cls, name: str, bases, dct):
        new_class = super().__new__(cls, name, bases, dct)
        reveal_type(new_class, expected_text="Self@FirstLevelMeta")
        return new_class


class SecondLevelMeta(FirstLevelMeta):
    def __new__(cls, name: str, bases, dct):
        new_class = super().__new__(cls, name, bases, dct)
        reveal_type(new_class, expected_text="Self@SecondLevelMeta")
        return new_class


class ThirdLevelMeta(SecondLevelMeta):
    def __new__(cls, name: str, bases, dct):
        new_class = super().__new__(cls, name, bases, dct)
        reveal_type(new_class, expected_text="Self@ThirdLevelMeta")
        return new_class
