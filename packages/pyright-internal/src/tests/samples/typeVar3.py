# This sample tests various diagnostics related to TypeVar usage.

from typing import Generic, List, Optional, TypeVar


_T = TypeVar("_T")
_S = TypeVar("_S")


class OuterClass(Generic[_T]):
    # This should generate an error because _S
    # isn't defined in this context.
    my_var: _S

    # This should generate an error because _T
    # is already in use.
    class InnerClass1(Generic[_T]):
        ...

    class InnerClass2(Generic[_S]):
        my_var2: _T


def func1(a: _T) -> Optional[_T]:
    # This should generate an error
    my_var: _S

    # This should generate an error because _T
    # is already in use.
    class InnerClass3(Generic[_T]):
        ...


# This should generate an error.
a: _S = 3

# This should generate an error.
b: List[_T] = []
