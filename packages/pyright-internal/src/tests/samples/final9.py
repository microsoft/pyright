# This sample tests that Final is not allowed as a type argument
# in a base class or in a constructor call (like ClassVar).

from typing import ClassVar, Final, Generic, TypeVar

T = TypeVar("T")


class G(Generic[T]): ...


# This should generate an error because Final is not allowed
# as a type argument in a base class.
class B(list[Final[int]]): ...


# This should generate an error because ClassVar is not allowed
# as a type argument in a base class.
class C(list[ClassVar[int]]): ...


# This should generate an error because Final is not allowed
# as a type argument in a constructor call.
a = G[Final[int]]()

# This should generate an error because ClassVar is not allowed
# as a type argument in a constructor call.
b = G[ClassVar[int]]()
