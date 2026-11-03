# This sample tests rejection of incompatible recursive TypedDicts, including
# read-only cycles whose inner comparison depends on an unfinished outer one.

from typing import Generic, TypeVar, TypedDict
from typing_extensions import ReadOnly


class ReadOnlyInt(TypedDict):
    next: ReadOnly["ReadOnlyInt"]
    value: ReadOnly[int]


class ReadOnlyStr(TypedDict):
    next: ReadOnly["ReadOnlyStr"]
    value: ReadOnly[str]


class IntChild(TypedDict):
    parent: ReadOnly["IntParent"]


class IntParent(TypedDict):
    child: ReadOnly[IntChild]
    value: ReadOnly[int]


class StrChild(TypedDict):
    parent: ReadOnly["StrParent"]


class StrParent(TypedDict):
    child: ReadOnly[StrChild]
    value: ReadOnly[str]


class IntWrapper(TypedDict):
    parent: ReadOnly[IntParent]
    child: ReadOnly[IntChild]
    again: ReadOnly[IntChild]


class StrWrapper(TypedDict):
    parent: ReadOnly[StrParent]
    child: ReadOnly[StrChild]
    again: ReadOnly[StrChild]


T = TypeVar("T")


class GenericA(TypedDict, Generic[T]):
    next: ReadOnly["GenericA[T]"]
    value: ReadOnly[T]


class GenericB(TypedDict, Generic[T]):
    next: ReadOnly["GenericB[T]"]
    value: ReadOnly[T]


def infer(source: GenericA[T]) -> T:
    return source["value"]


def func(
    int_tree: ReadOnlyInt,
    str_tree: ReadOnlyStr,
    parent: StrParent,
    child: StrChild,
    wrapper: StrWrapper,
    generic_int: GenericB[int],
    generic_str: GenericB[str],
):
    # This should generate an error despite the compatible recursive edge.
    bad_tree: ReadOnlyInt = str_tree

    # These should each generate an error. An inner comparison must not
    # retain a success that depended on an incompatible outer comparison.
    bad_parent: IntParent = parent
    bad_child: IntChild = child
    bad_wrapper: IntWrapper = wrapper

    good_int: GenericA[int] = generic_int
    good_str: GenericA[str] = generic_str

    # This should generate an error; specializations are part of the comparison.
    bad_generic: GenericA[int] = generic_str

    reveal_type(infer(generic_int), expected_text="int")
    reveal_type(infer(generic_str), expected_text="str")
