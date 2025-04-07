# This sample tests the logic that validates the second parameter to
# an isinstance or issubclass call and ensures that it's a class or
# tuple of classes.


import sys
from abc import abstractmethod
from typing import (
    Annotated,
    Any,
    Callable,
    Generic,
    Sequence,
    Tuple,
    Type,
    TypeVar,
    TypedDict,
    Union,
)

if sys.version_info >= (3, 10):
    from types import NoneType
else:
    NoneType = type(None)

_T = TypeVar("_T", int, str)


class A(Generic[_T]):
    pass


a = A()

if isinstance(a, A):
    pass

# This should generate an error because generic types with
# subscripts are not allowed.
if isinstance(a, A[str]):
    pass

# This should generate an error in Python 3.9 and older because
# unions are not allowed, but this error isn't currently caught.
if issubclass(A, Union[A, int]):
    pass

if issubclass(A, type(None)):
    pass

if issubclass(A, NoneType):
    pass


class ClassA(Generic[_T]):
    v1: _T
    v2: Type[_T]

    @property
    @abstractmethod
    def _elem_type_(self) -> Union[Type[_T], Tuple[Type[_T], ...]]:
        raise NotImplementedError

    def check_type(self, var: Any) -> bool:
        return isinstance(var, self._elem_type_)

    def execute(self, var: Union[_T, Tuple[_T]]) -> None:
        if isinstance(var, self._elem_type_):
            pass

        if isinstance(var, type(self.v1)):
            pass

        if isinstance(var, self.v2):
            pass


def func1(exceptions: Sequence[type[BaseException]], exception: Exception):
    return isinstance(exception, tuple(exceptions))


if isinstance(a, Callable):
    ...

# This should generate an error because a subscripted Callable
# will result in a runtime exception.
if isinstance(a, Callable[[], Any]):
    ...

if isinstance(a, type(len)):
    ...


class TD1(TypedDict):
    a: int


# This should generate an error because TypedDict classes can't
# be used in an isinstance call.
if isinstance(a, TD1):
    pass


TA1 = Annotated[int, ""]

# This should generate two errors because Annotated can't be used
# in an isinstance call.
if isinstance(1, TA1):
    pass

# This should generate an error because Any can't be used
# in an isinstance call.
if isinstance(1, Any):
    pass

# This should generate an error because Literal can't be used
# in an isinstance call.
if isinstance(1, Literal[1, 2]):
    pass
