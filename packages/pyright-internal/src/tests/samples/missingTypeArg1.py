# This sample tests the reportMissingTypeArgument diagnostic rule.

import collections
from typing import Generic, TypeVar


_T1 = TypeVar("_T1")


class Class1(Generic[_T1]):
    pass


# This should generate an error when reportMissingTypeArgument is enabled.
class Class2(Class1):
    pass


# This should generate an error when reportMissingTypeArgument is enabled.
_T2 = TypeVar("_T2", bound=Class1)


# This should generate an error when reportMissingTypeArgument is enabled.
var1: Class1 | None = None


GenericTypeAlias = Class1[_T1] | int


# This should generate an error when reportMissingTypeArgument is enabled.
var2: GenericTypeAlias | None = None


class Class3(Generic[_T1, _T2]):
    pass


# This should generate an error regardless of whether reportMissingTypeArgument
# is enabled because this class requires two type arguments and this will
# generate a runtime exception.
a = Class3[int]


# This should generate an error when reportMissingTypeArgument is enabled.
def func1() -> collections.deque: ...


def func2(obj: object):
    if isinstance(obj, Class1):
        pass
    if isinstance(obj, Class1 | Class2):
        pass


class ClassA:
    @staticmethod
    def method1(data: int | str | dict[str, str]):
        if isinstance(data, dict | str):
            return data
