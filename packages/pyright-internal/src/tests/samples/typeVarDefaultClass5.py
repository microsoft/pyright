# This sample tests specialization of a subclass that retains a type
# parameter from its base class, both with and without a default.

from typing import Generic

from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]

T = TypeVar("T")
U = TypeVar("U")
DefaultT = TypeVar("DefaultT", default=str)


class Parent(Generic[T, DefaultT]):
    pass


class Child(Parent[int, DefaultT]):
    pass


valid: type[Child[str]] = Child

# This should generate an error because Child uses str for DefaultT.
invalid: type[Child[int]] = Child


# A subclass can also retain a type parameter that has no default. In that
# case the retained parameter specializes to Unknown, which is assignable to
# any specialization, so neither of the assignments below should error.
class ChildNoDefault(Parent[int, U]):
    pass


retained_int: type[ChildNoDefault[int]] = ChildNoDefault
retained_str: type[ChildNoDefault[str]] = ChildNoDefault
