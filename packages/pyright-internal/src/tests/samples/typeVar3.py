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
        my_var1: _S

        # This should generate an error because _T
        # is already in use in the outer class.
        my_var2: _T

    class InnerClass3:
        # This should generate an error.
        x: List[_T]

        # This should generate two errors (one for each "_T").
        def f(self, x: _T, y: _S, z: _S) -> _T:
            ...

        def g(self) -> None:
            # This should generate an error.
            y: List[_T]


def func1(a: _T) -> Optional[_T]:
    my_var1: _T

    # This should generate an error
    my_var2: _S

    # This should generate an error because _T
    # is already in use.
    class InnerClass3(Generic[_T]):
        ...


# This should generate an error.
a: _S = 3

# This should generate an error.
b: List[_T] = []
