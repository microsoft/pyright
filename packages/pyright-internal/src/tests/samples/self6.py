# This sample tests that a Self type used within a `__new__` method does
# not preclude the use of a contravariant TypeVar within a generic class.

from typing import Self, TypeVar, Generic

T_contra = TypeVar("T_contra", contravariant=True)


class MyClass(Generic[T_contra]):
    def __new__(cls: type[Self]) -> Self: ...


MyClass[int]()
