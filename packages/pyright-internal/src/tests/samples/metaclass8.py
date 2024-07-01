# This sample tests the case where a generic class is used
# for a metaclass.

from typing import Any, Generic, TypeVar


T = TypeVar("T")


class A(type, Generic[T]): ...


# This should generate an error because generic metaclasses are not allowed.
class B(Generic[T], metaclass=A[T]): ...


class C(metaclass=A[Any]): ...
