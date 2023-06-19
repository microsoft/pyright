# This sample tests the type handler's handling of the
# built-in NewType function.

from typing import NewType, TypeVar

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


def func1(x: type[_T]) -> type[_T]:
    return x


MyString2 = NewType("MyString2", func1(str))

# This should generate an error because NewType requires two arguments.
NewTypeBad1 = NewType()

# This should generate an error because NewType requires two arguments.
NewTypeBad2 = NewType("Hi")

# This should generate an error because NewType requires two arguments.
NewTypeBad3 = NewType("Hi", int, int)

# This should generate an error because the first argument must be a string literal.
NewTypeBad4 = NewType(int, int)

args = ("Hi", int)
# This should generate an error because two positional args are needed.
NewTypeBad5 = NewType(*args)
