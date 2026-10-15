# This sample tests type narrowing for isinstance and issubclass when
# the class argument is passed as a type[T] variable or tuple of type[T].

# pyright: reportMissingModuleSource=false

from typing import Any, Generic, TypeVar, assert_never, final
from typing_extensions import reveal_type

from nonexistent import Unknown  # pyright: ignore[reportMissingImports]


class A:
    pass


class B:
    pass


@final
class FinalClass:
    pass


def test_positive_narrowing(x: A | B, cls: type[A]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="A")


def test_positive_tuple_param(x: A | B | FinalClass, types: tuple[type[A], type[B]]):
    if isinstance(x, types):
        reveal_type(x, expected_text="A | B")


def test_final_class_param(x: FinalClass | B, cls: type[FinalClass]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="FinalClass")
    else:
        reveal_type(x, expected_text="B")


def test_non_final_negative(x: A | B, cls: type[A]):
    if not isinstance(x, cls):
        reveal_type(x, expected_text="A | B")


def test_issubclass(x: type[FinalClass] | type[B], cls: type[FinalClass]):
    if issubclass(x, cls):
        reveal_type(x, expected_text="type[FinalClass]")
    else:
        reveal_type(x, expected_text="type[B]")


def test_issubclass_non_final(x: type[A] | type[B], cls: type[A]):
    if not issubclass(x, cls):
        reveal_type(x, expected_text="type[A] | type[B]")


@final
class FinalClass2:
    pass


def test_final_union_filter(
    x: FinalClass | FinalClass2 | B, cls: type[FinalClass] | type[FinalClass2]
) -> B:
    if not isinstance(x, cls):
        reveal_type(x, expected_text="FinalClass | FinalClass2 | B")
        # This should generate an error because cls checks only one class.
        return x
    return B()


def test_final_unbounded_tuple(x: FinalClass | B, types: tuple[type[FinalClass], ...]):
    if not isinstance(x, types):
        reveal_type(x, expected_text="FinalClass | B")


def test_final_unbounded_tuple_issubclass(
    x: type[FinalClass] | type[B], types: tuple[type[FinalClass], ...]
):
    if not issubclass(x, types):
        reveal_type(x, expected_text="type[FinalClass] | type[B]")


def test_final_bounded_tuple(x: FinalClass | FinalClass2 | B, types: tuple[type[FinalClass], type[FinalClass2]]):
    if isinstance(x, types):
        reveal_type(x, expected_text="FinalClass | FinalClass2")
    else:
        reveal_type(x, expected_text="B")


def test_type_any(x: A | B, cls: type[Any]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="A | B")
    else:
        reveal_type(x, expected_text="A | B")


def test_final_union_filter_issubclass(
    x: type[FinalClass] | type[FinalClass2] | type[B],
    cls: type[FinalClass] | type[FinalClass2],
) -> type[B]:
    if not issubclass(x, cls):
        reveal_type(x, expected_text="type[FinalClass] | type[FinalClass2] | type[B]")
        # This should generate an error because cls checks only one class.
        return x
    return B


def test_non_exhaustive_union(x: FinalClass | FinalClass2, cls: type[FinalClass] | type[FinalClass2]):
    if not isinstance(x, cls):
        reveal_type(x, expected_text="FinalClass | FinalClass2")
        # This should generate an error because the negative branch is reachable.
        assert_never(x)


def test_union_type_argument(x: FinalClass | FinalClass2 | B, cls: type[FinalClass | FinalClass2]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="FinalClass | FinalClass2")
    else:
        reveal_type(x, expected_text="FinalClass | FinalClass2 | B")


def test_union_tuple_entry(
    x: FinalClass | FinalClass2 | B,
    types: tuple[type[FinalClass], type[FinalClass] | type[FinalClass2]],
):
    if isinstance(x, types):
        reveal_type(x, expected_text="FinalClass | FinalClass2")
    else:
        reveal_type(x, expected_text="FinalClass2 | B")


def test_union_tuple_entry_issubclass(
    x: type[FinalClass] | type[FinalClass2] | type[B],
    types: tuple[type[FinalClass], type[FinalClass] | type[FinalClass2]],
):
    if issubclass(x, types):
        reveal_type(x, expected_text="type[FinalClass] | type[FinalClass2]")
    else:
        reveal_type(x, expected_text="type[FinalClass2] | type[B]")


def test_runtime_union(x: FinalClass | FinalClass2 | B):
    if isinstance(x, FinalClass | FinalClass2):
        reveal_type(x, expected_text="FinalClass | FinalClass2")
    else:
        reveal_type(x, expected_text="B")


def test_runtime_union_issubclass(x: type[FinalClass] | type[FinalClass2] | type[B]):
    if issubclass(x, FinalClass | FinalClass2):
        reveal_type(x, expected_text="type[FinalClass] | type[FinalClass2]")
    else:
        reveal_type(x, expected_text="type[B]")


def test_fixed_unbounded_tuple(x: int | str, extra: tuple[type[A], ...]):
    if not isinstance(x, (int, *extra)):
        reveal_type(x, expected_text="str")


def test_fixed_unbounded_tuple_issubclass(x: type[int] | type[str], extra: tuple[type[A], ...]):
    if not issubclass(x, (int, *extra)):
        reveal_type(x, expected_text="type[str]")


def test_nested_unbounded_tuple(x: FinalClass | B, extra: tuple[type[FinalClass2], ...]):
    if not isinstance(x, ((FinalClass,), extra)):
        reveal_type(x, expected_text="B")


def test_nested_unbounded_tuple_issubclass(
    x: type[FinalClass] | type[B], extra: tuple[type[FinalClass2], ...]
):
    if not issubclass(x, ((FinalClass,), extra)):
        reveal_type(x, expected_text="type[B]")


def test_type_any_issubclass(x: type[A] | type[B], cls: type[Any]):
    if issubclass(x, cls):
        reveal_type(x, expected_text="type[A] | type[B]")
    else:
        reveal_type(x, expected_text="type[A] | type[B]")


def test_type_unknown(x: A | B, cls: type[Unknown]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="A | B")
    else:
        reveal_type(x, expected_text="A | B")


def test_type_unknown_issubclass(x: type[A] | type[B], cls: type[Unknown]):
    if issubclass(x, cls):
        reveal_type(x, expected_text="type[A] | type[B]")
    else:
        reveal_type(x, expected_text="type[A] | type[B]")


T = TypeVar("T")


@final
class FinalGeneric(Generic[T]):
    pass


def test_final_generic(x: FinalGeneric[int] | B, cls: type[FinalGeneric[int]]):
    if isinstance(x, cls):
        reveal_type(x, expected_text="FinalGeneric[int]")
    else:
        reveal_type(x, expected_text="B")


def test_unbounded_typevar(x: T, types: tuple[type[T], ...]):
    if not isinstance(x, types):
        reveal_type(x, expected_text="T@test_unbounded_typevar")


def test_runtime_union_params(x: FinalClass | FinalClass2 | B, cls1: type[FinalClass], cls2: type[FinalClass2]):
    if isinstance(x, cls1 | cls2):
        reveal_type(x, expected_text="FinalClass | FinalClass2")
    else:
        reveal_type(x, expected_text="B")


def test_runtime_union_alternative(
    x: FinalClass | FinalClass2 | B, cls: type[FinalClass] | type[FinalClass2]
):
    if isinstance(x, cls | B):
        reveal_type(x, expected_text="FinalClass | FinalClass2 | B")
    else:
        reveal_type(x, expected_text="FinalClass | FinalClass2")


def test_runtime_union_optional_tuple(x: int | str | None, extra: tuple[type[A], ...]):
    if not isinstance(x, (int | type(None), *extra)):
        reveal_type(x, expected_text="str")


def test_runtime_union_unpacked_tuple(x: int | str | None, extra: tuple[type[A], type[B]]):
    if not isinstance(x, (*extra, int | type(None))):
        reveal_type(x, expected_text="str")


def test_tuple_alternatives(x: FinalClass | FinalClass2 | B, types: tuple[type[FinalClass]] | tuple[type[FinalClass2]]):
    if isinstance(x, types):
        reveal_type(x, expected_text="FinalClass | FinalClass2")
    else:
        reveal_type(x, expected_text="FinalClass | FinalClass2 | B")


def test_runtime_union_none(x: int | str | None) -> int | None:
    if isinstance(x, int | None):
        reveal_type(x, expected_text="int | None")
        return x
    reveal_type(x, expected_text="str")
    return None


def test_runtime_union_none_type(x: int | str | None) -> int | None:
    if isinstance(x, int | type(None)):
        reveal_type(x, expected_text="int | None")
        return x
    reveal_type(x, expected_text="str")
    return None


def test_runtime_union_none_reversed(x: int | str | None):
    if isinstance(x, None | int):
        reveal_type(x, expected_text="int | None")
    else:
        reveal_type(x, expected_text="str")


def test_nested_runtime_union_none(x: int | str | None):
    if isinstance(x, ((int | None,),)):
        reveal_type(x, expected_text="int | None")
    else:
        reveal_type(x, expected_text="str")


def test_runtime_union_none_optional_tuple(x: int | str | None, extra: tuple[type[A], ...]):
    if isinstance(x, (int | None, *extra)):
        reveal_type(x, expected_text="int | None")
    else:
        reveal_type(x, expected_text="str")


def test_runtime_union_none_issubclass(x: type[int] | type[str] | type[None]):
    if issubclass(x, int | None):
        reveal_type(x, expected_text="type[int] | type[None]")
    else:
        reveal_type(x, expected_text="type[str]")


def test_runtime_union_none_reversed_issubclass(x: type[int] | type[str] | type[None]):
    if issubclass(x, None | int):
        reveal_type(x, expected_text="type[int] | type[None]")
    else:
        reveal_type(x, expected_text="type[str]")


def test_runtime_union_none_type_issubclass(x: type[int] | type[str] | type[None]):
    if issubclass(x, int | type(None)):
        reveal_type(x, expected_text="type[int] | type[None]")
    else:
        reveal_type(x, expected_text="type[str]")


def test_runtime_union_none_class_object(x: int | type[FinalClass] | None) -> int | None:
    if isinstance(x, int | None):
        reveal_type(x, expected_text="int | None")
        return x
    reveal_type(x, expected_text="type[FinalClass]")
    return None


def test_runtime_union_none_alternative(
    x: FinalClass | FinalClass2 | B | None, cls: type[FinalClass] | type[FinalClass2]
):
    if isinstance(x, cls | None):
        reveal_type(x, expected_text="FinalClass | FinalClass2 | None")
    else:
        reveal_type(x, expected_text="FinalClass | FinalClass2 | B")
