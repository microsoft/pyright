# This sample checks that isinstance and issubclass don't
# allow the second argument to be a Protocol class.

from inspect import isfunction
from typing import Any, Callable, Protocol, Type, TypeVar, Union
from types import FunctionType, LambdaType


class MyProtocol(Protocol):
    pass


# This should generate an error because Sized is a Protocol that
# is not runtime checkable.
isinstance(4, MyProtocol)


# This should generate an error because Iterable is a Protocol.
issubclass(str, (str, MyProtocol))


class CustomClass:
    def __call__(self, *args: Any):
        pass


def get_type_of_object(object: Union[Callable[..., Any], CustomClass]):
    # This would normally generate an error, but FunctionType is special.
    if isinstance(object, FunctionType):
        return "is function"

    if isinstance(object, LambdaType):
        return "is lambda"

    if isinstance(object, Callable):
        return "is callable"

    return "nothing"


_T1 = TypeVar("_T1", bound=CustomClass)


def func1(cls: Type[_T1], val: _T1):
    if issubclass(cls, CustomClass):
        reveal_type(cls, expected_text="Type[CustomClass]*")
    else:
        reveal_type(cls, expected_text="Never")


_T2 = TypeVar("_T2")


def func2(x: _T2) -> Union[_T2, int]:
    if callable(x) and isfunction(x):
        return 1
    return x
