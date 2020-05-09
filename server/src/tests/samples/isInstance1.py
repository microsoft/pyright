# This sample checks that isinstance and issubclass don't
# allow the second argument to be a Protocol class.

from typing import Any, Callable, Iterable, Sized, Union
from types import FunctionType, LambdaType


# This should generate an error because Sized is a Protocol.
isinstance(4, Sized)


# This should generate an error because Iterable is a Protocol.
issubclass(str, (str, Iterable))


class CustomClass:
    def __call__(self, *args: Any):
        pass


def get_type_of_object(object: Union[Callable[..., Any], CustomClass]):
    # This would normally generate an error, but FunctionType is special.
    if isinstance(object, FunctionType):
        return "is function"

    if isinstance(object, LambdaType):
        return "is lambda"

    if callable(object):
        return "is callable"

    return "nothing"
