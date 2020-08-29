# This sample tests the logic that validates the second parameter to
# an isinstance or issubclass call and ensures that it's a class or
# tuple of classes.


from typing import Generic, TypeVar, Union


_T = TypeVar("_T")


class A(Generic[_T]):
    pass


a = A()

if isinstance(a, A):
    pass

# This should generate an error because generic types with
# subscripts are not allowed.
if isinstance(a, A[str]):
    pass

# This should generate an error because unions are not
# allowed.
if issubclass(a, Union[A, int]):
    pass
