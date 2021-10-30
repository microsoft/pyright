# This sample tests error handling for the "Generic" special form.

from typing import Generic, TypeVar

T = TypeVar("T")

# This should generate an error.
class Class1(Generic):
    ...

# This should generate two errors (a parse error and a semantic error).
class Class2(Generic[]):
    ...

# This should generate an error.
class Class3(Generic[int]):
    ...

# This should generate two errors.
class Class4(Generic[T, T, T]):
    ...


# This should generate an error.
def func1(x: Generic[T]) -> T:
    ...

# This should generate an error.
def func2(x: T) -> Generic[T]:
    ...

class Class5(Generic[T]):
    # This should generate an error.
    x: Generic[T]


def func3(x: type):
    if x is Generic:
        return


