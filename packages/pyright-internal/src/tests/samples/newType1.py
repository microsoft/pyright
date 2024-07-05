# This sample tests the type handler's handling of the
# built-in NewType function.

from abc import ABC, abstractmethod
from typing import Any, NewType, TypeVar, TypedDict

MyString = NewType("MyString", "str")


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
NewTypeBad2 = NewType("NewTypeBad2")

# This should generate an error because NewType requires two arguments.
NewTypeBad3 = NewType("NewTypeBad3", int, int)

# This should generate an error because the first argument must be a string literal.
NewTypeBad4 = NewType(int, int)

args = ("Hi", int)
# This should generate an error because two positional args are needed.
NewTypeBad5 = NewType(*args)

# This should generate an error because type cannot be Any.
NewTypeBad6 = NewType("NewTypeBad6", Any)


class TD1(TypedDict):
    x: int


# This should generate an error because type cannot be a TypedDict.
NewTypeBad7 = NewType("NewTypeBad7", TD1)

NewTypeGood8 = NewType("NewTypeGood8", MyString)

# This should generate an error because the name doesn't match.
NewTypeBad9 = NewType("NewTypeBad9Not", int)


def func2(x: MyString):
    # This should generate an error because isinstance can't be used
    # with a NewType.
    if isinstance(x, MyString):
        pass

    # This should generate an error because issubclass can't be used
    # with a NewType.
    if issubclass(type(x), (MyString, int)):
        pass


class AbstractBase(ABC):
    @abstractmethod
    def method1(self, /) -> int: ...


class DerivedBase(AbstractBase):
    def method1(self, /) -> int:
        return 0


NewDerived = NewType("NewDerived", AbstractBase)
new_derived = NewDerived(DerivedBase())
