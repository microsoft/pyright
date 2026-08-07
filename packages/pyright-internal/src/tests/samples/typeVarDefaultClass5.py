# This sample tests specialization of a subclass that retains a type
# parameter from its base class, both with and without a default.

from typing import Any, Generic, assert_type

from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]

T = TypeVar("T")
U = TypeVar("U")
DefaultT = TypeVar("DefaultT", default=str)
FunctionDefaultT = TypeVar("FunctionDefaultT", default=str)
AnyDefaultT = TypeVar("AnyDefaultT", default=Any)


class Parent(Generic[T, DefaultT]):
    pass


class Child(Parent[int, DefaultT]):
    pass


valid: type[Child[str]] = Child

# This should generate an error because Child uses str for DefaultT.
invalid: type[Child[int]] = Child
assert_type(Child[bool](), Child[bool])


# A subclass can also retain a type parameter that has no default. In that
# case the retained parameter specializes to Unknown, which is assignable to
# any specialization, so neither of the assignments below should error.
class ChildNoDefault(Parent[int, U]):
    pass


retained_int: type[ChildNoDefault[int]] = ChildNoDefault
retained_str: type[ChildNoDefault[str]] = ChildNoDefault


class ParentMixed(Generic[T, U, DefaultT]):
    pass


class ChildMixed(ParentMixed[int, U, DefaultT]):
    pass


mixed_int: type[ChildMixed[int, str]] = ChildMixed
mixed_bool: type[ChildMixed[bool, str]] = ChildMixed


def use_mixed_function_default(
    cls: type[ChildMixed[FunctionDefaultT, str]],
) -> FunctionDefaultT:
    raise NotImplementedError


assert_type(use_mixed_function_default(ChildMixed), str)


class ChildAnyDefault(Parent[int, AnyDefaultT]):
    pass


any_default_int: type[ChildAnyDefault[int]] = ChildAnyDefault
any_default_str: type[ChildAnyDefault[str]] = ChildAnyDefault


class NoDefaultParent(Generic[T]):
    pass


def use_function_default(cls: type[NoDefaultParent[FunctionDefaultT]]) -> FunctionDefaultT:
    raise NotImplementedError


# A bare generic class with no default shouldn't solve another TypeVar to Unknown.
assert_type(use_function_default(NoDefaultParent), str)
