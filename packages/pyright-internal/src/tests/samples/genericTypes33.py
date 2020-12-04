# This sample tests the reportMissingTypeArgument diagnostic rule.

from typing import Generic, Optional, TypeVar, Union

_T1 = TypeVar("_T1")


class Class1(Generic[_T1]):
    pass


# This should generate an error when reportMissingTypeArgument is enabled.
class Class2(Class1):
    pass


# This should generate an error when reportMissingTypeArgument is enabled.
_T2 = TypeVar("_T2", bound=Class1)


# This should generate an error when reportMissingTypeArgument is enabled.
var1: Optional[Class1] = None


GenericTypeAlias = Union[Class1[_T1], int]


# This should generate an error when reportMissingTypeArgument is enabled.
var2: Optional[GenericTypeAlias] = None


class Class3(Generic[_T1, _T2]):
    pass


# This should generate an error when reportMissingTypeArgument is enabled
# because this class requires two type arguments.
a = Class3[int]
