# This sample tests specialization of a subclass that retains a type
# parameter from its base class, both with and without a default.

from collections.abc import Callable
from typing import Any, Generic, assert_type, cast

from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    ParamSpec,
    TypeVar,
    TypeVarTuple,
    Unpack,
)

T = TypeVar("T")
U = TypeVar("U")
DefaultT = TypeVar("DefaultT", default=str)
FunctionDefaultT = TypeVar("FunctionDefaultT", default=str)
AnyDefaultT = TypeVar("AnyDefaultT", default=Any)
DependentAnyDefaultT = TypeVar("DependentAnyDefaultT", default=AnyDefaultT)
NestedAnyDefaultT = TypeVar("NestedAnyDefaultT", default=tuple[Any, ...])
UnionAnyDefaultT = TypeVar("UnionAnyDefaultT", default=int | Any)
P = ParamSpec("P")
GradualP = ParamSpec("GradualP", default=...)
Ts = TypeVarTuple("Ts")
GradualTs = TypeVarTuple("GradualTs", default=Unpack[tuple[Any, ...]])


class Parent(Generic[T, DefaultT]):
    pass


class Child(Parent[int, DefaultT]):
    pass


valid: type[Child[str]] = Child

# This should generate an error because Child uses str for DefaultT.
invalid: type[Child[int]] = Child
assert_type(Child[bool](), Child[bool])


# A subclass can also retain a type parameter that has no default. In that
# case the class remains unspecialized, so neither assignment below should
# generate an error.
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


def infer_any_default(cls: type[ChildAnyDefault[T]], value: T) -> T:
    raise NotImplementedError


assert_type(infer_any_default(ChildAnyDefault, 1), int)


class DependentAnyDefaults(Generic[AnyDefaultT, DependentAnyDefaultT]):
    pass


def infer_dependent_any_default(cls: type[DependentAnyDefaults[T, T]], value: T) -> T:
    raise NotImplementedError


assert_type(infer_dependent_any_default(DependentAnyDefaults, 1), int)


class ChildNestedAnyDefault(Parent[int, NestedAnyDefaultT]):
    pass


def infer_nested_any_default(cls: type[ChildNestedAnyDefault[T]]) -> T:
    raise NotImplementedError


assert_type(infer_nested_any_default(ChildNestedAnyDefault), tuple[Any, ...])


class ChildUnionAnyDefault(Parent[int, UnionAnyDefaultT]):
    pass


def infer_union_any_default(cls: type[ChildUnionAnyDefault[T]], value: T) -> T:
    raise NotImplementedError


assert_type(infer_union_any_default(ChildUnionAnyDefault, 1), int)


class GradualVariadic(Generic[*GradualTs]):
    pass


def infer_gradual_variadic(
    cls: type[GradualVariadic[*Ts]],
    *values: *Ts,
) -> tuple[*Ts]:
    raise NotImplementedError


assert_type(infer_gradual_variadic(GradualVariadic, 1, ""), tuple[int, str])


class GradualCallable(Generic[GradualP]):
    pass


def infer_gradual_callable(
    cls: type[GradualCallable[P]],
    callback: Callable[P, None],
) -> Callable[P, None]:
    raise NotImplementedError


def int_callback(value: int) -> None:
    pass


int_callable = cast(Callable[[int], None], int_callback)
assert_type(infer_gradual_callable(GradualCallable, int_callable), Callable[[int], None])


class NoDefaultParent(Generic[T]):
    pass


def use_function_default(cls: type[NoDefaultParent[FunctionDefaultT]]) -> FunctionDefaultT:
    raise NotImplementedError


# A bare generic class with no default shouldn't solve another TypeVar to Unknown.
assert_type(use_function_default(NoDefaultParent), str)
