# This sample tests the logic that validates the second parameter to
# an isinstance or issubclass call and ensures that it's a class or
# tuple of classes.


from abc import abstractmethod
from typing import Any, Generic, Tuple, Type, TypeVar, Union


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

# This should generate an error in Python 3.9 and older
# because unions are not allowed.
if issubclass(A, Union[A, int]):
    pass

# This should generate an error in Python 3.9 and older
# because unions are not allowed. A second error will be
# generated because the | operator isn't allowed.
if issubclass(A, A | int):
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
