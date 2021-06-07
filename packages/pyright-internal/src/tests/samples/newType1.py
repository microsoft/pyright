# This sample tests the type handler's handling of the
# built-in NewType function.

from typing import NewType, Type, TypeVar

MyString = NewType("MyString", str)


def must_take_string(p1: str):
    pass


must_take_string(MyString("hello"))


def must_take_my_string(p1: MyString):
    pass


must_take_my_string(MyString("hello"))

# This should generate an error because 'hello'
# isn't a valid MyString.
must_take_my_string("hello")


_T = TypeVar("_T")


def func1(x: Type[_T]) -> Type[_T]:
    return x


MyString2 = NewType("MyString2", func1(str))
