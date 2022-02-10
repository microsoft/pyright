# This sample tests type checking scenarios related to "pseudo generic"
# classes - those whose constructors are unannotated.

from typing import List

_DEFAULT_VALUE = object()


class MyClass(object):
    def __init__(
        self,
        name,
        description=_DEFAULT_VALUE,
    ):
        ...


x: List[MyClass] = [MyClass("a", description="b")]
y: List[MyClass] = [MyClass("c")]
z: List[MyClass] = x + y
