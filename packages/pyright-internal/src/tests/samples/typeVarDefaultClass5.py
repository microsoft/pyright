# This sample tests specialization of a subclass that retains a defaulted
# type parameter from its base class.

from typing import Generic

from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]

T = TypeVar("T")
DefaultT = TypeVar("DefaultT", default=str)


class Parent(Generic[T, DefaultT]):
    pass


class Child(Parent[int, DefaultT]):
    pass


valid: type[Child[str]] = Child

# This should generate an error because Child uses str for DefaultT.
invalid: type[Child[int]] = Child
