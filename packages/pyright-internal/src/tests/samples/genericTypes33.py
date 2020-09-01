# This sample tests the reportMissingTypeArgument diagnostic rule.

from typing import Generic, Optional, TypeVar, Union

_T = TypeVar("_T")


class Class1(Generic[_T]):
    pass


# This should generate an error when reportMissingTypeArgument is enabled.
class Class2(Class1):
    pass


# This should not generate an error.
_T2 = TypeVar("_T2", bound=Class1)


# This should generate an error when reportMissingTypeArgument is enabled.
var1: Optional[Class1] = None


GenericTypeAlias = Union[Class1[_T], int]


# This should generate an error when reportMissingTypeArgument is enabled.
var2: Optional[GenericTypeAlias] = None

