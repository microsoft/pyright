# This sample tests the case where a type variable is used to define
# the extra_items in a TypedDict.

from typing_extensions import NotRequired, ReadOnly, TypedDict  # pyright: ignore[reportMissingModuleSource]


class TD1[T](TypedDict, extra_items=T):
    a: T


class IntTD(TD1[int]):
    b: NotRequired[int]


class StrTD(TD1[str]):
    b: NotRequired[str]


class GenericTD[U](TD1[list[U]]):
    b: NotRequired[list[U]]


class NestedIntTD(GenericTD[int]):
    pass


class ReadOnlyTD[T](TypedDict, extra_items=ReadOnly[T]):
    a: T


class ReadOnlyIntTD(ReadOnlyTD[int]):
    pass


d1: TD1 = {"a": 1}
d2: TD1[int] = {"a": 1}

reveal_type(d1["other"], expected_text="Unknown")
reveal_type(d2["other"], expected_text="int")


def inherited_extras(i: IntTD, s: StrTD, generic: GenericTD[str], nested: NestedIntTD, readonly: ReadOnlyIntTD):
    reveal_type(i["a"], expected_text="int")
    reveal_type(i["other"], expected_text="int")
    reveal_type(s["other"], expected_text="str")
    reveal_type(generic["other"], expected_text="list[str]")
    reveal_type(nested["other"], expected_text="list[int]")
    reveal_type(readonly["other"], expected_text="int")
    i["other"] = 2
    nested["other"] = [1]

    # This should generate an error.
    i["other"] = "wrong"

    # This should generate an error.
    s["other"] = 1

    # This should generate an error.
    nested["other"] = ["wrong"]

    # This should generate an error.
    readonly["other"] = 3


int_instance = IntTD(a=1, other=2)
str_instance = StrTD(a="ready", other="done")
nested_instance = NestedIntTD(a=[1], other=[2])
readonly_instance = ReadOnlyIntTD(a=1, other=2)

# This should generate an error.
invalid_instance = IntTD(a=1, other="wrong")
