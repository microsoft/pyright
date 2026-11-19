# This sample tests that Final and ClassVar cannot be used as type arguments
# in a base class or constructor call.
# https://github.com/microsoft/pyright/issues/12020

from typing import ClassVar, Final, Generic, TypeVar

T = TypeVar("T")


class G(Generic[T]): ...


# This should generate an error because Final is not allowed as a type argument.
class B(list[Final[int]]): ...


# This should generate an error because ClassVar is not allowed as a type argument.
class C(list[ClassVar[int]]): ...


# This should generate an error because Final is not allowed as a type argument.
class D(list[Final]): ...


# This should generate an error because ClassVar is not allowed as a type argument.
class E(list[ClassVar]): ...


# This should generate an error because Final is not allowed as a type argument.
a = G[Final[int]]()

# This should generate an error because ClassVar is not allowed as a type argument.
b = G[ClassVar[int]]()

# This should generate an error because Final is not allowed as a type argument.
c = G[Final]()

# This should generate an error because ClassVar is not allowed as a type argument.
d = G[ClassVar]()
