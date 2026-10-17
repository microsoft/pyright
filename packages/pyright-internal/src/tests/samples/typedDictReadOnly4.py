# This sample tests qualifier nesting in functional TypedDict declarations.
# ReadOnly, Required/NotRequired, and Annotated may appear in any order.

from typing import Annotated, NotRequired, ReadOnly, Required, TypedDict, assert_type
from typing import Annotated as A, NotRequired as N, ReadOnly as R, Required as Q


OptionalFields = TypedDict(
    "OptionalFields",
    {
        "key-0": ReadOnly[NotRequired[int]],
        "key-1": NotRequired[ReadOnly[int]],
        "key-2": Annotated[ReadOnly[NotRequired[int]], "metadata"],
        "key-3": Annotated[NotRequired[ReadOnly[int]], "metadata"],
        "key-4": ReadOnly[Annotated[NotRequired[int], "metadata"]],
        "key-5": NotRequired[Annotated[ReadOnly[int], "metadata"]],
        "key-6": ReadOnly[NotRequired[Annotated[int, "metadata"]]],
        "key-7": NotRequired[ReadOnly[Annotated[int, "metadata"]]],
    },
    total=True,
)


class OptionalFieldsClass(TypedDict, total=True):
    key0: ReadOnly[NotRequired[int]]
    key1: NotRequired[ReadOnly[int]]
    key2: Annotated[ReadOnly[NotRequired[int]], "metadata"]
    key3: Annotated[NotRequired[ReadOnly[int]], "metadata"]
    key4: ReadOnly[Annotated[NotRequired[int], "metadata"]]
    key5: NotRequired[Annotated[ReadOnly[int], "metadata"]]
    key6: ReadOnly[NotRequired[Annotated[int, "metadata"]]]
    key7: NotRequired[ReadOnly[Annotated[int, "metadata"]]]


RequiredFields = TypedDict(
    "RequiredFields",
    {
        "key-0": ReadOnly[Required[int]],
        "key-1": Required[ReadOnly[int]],
        "key-2": Annotated[ReadOnly[Required[int]], "metadata"],
        "key-3": Annotated[Required[ReadOnly[int]], "metadata"],
        "key-4": ReadOnly[Annotated[Required[int], "metadata"]],
        "key-5": Required[Annotated[ReadOnly[int], "metadata"]],
        "key-6": ReadOnly[Required[Annotated[int, "metadata"]]],
        "key-7": Required[ReadOnly[Annotated[int, "metadata"]]],
    },
    total=False,
)


class RequiredFieldsClass(TypedDict, total=False):
    key0: ReadOnly[Required[int]]
    key1: Required[ReadOnly[int]]
    key2: Annotated[ReadOnly[Required[int]], "metadata"]
    key3: Annotated[Required[ReadOnly[int]], "metadata"]
    key4: ReadOnly[Annotated[Required[int], "metadata"]]
    key5: Required[Annotated[ReadOnly[int], "metadata"]]
    key6: ReadOnly[Required[Annotated[int, "metadata"]]]
    key7: Required[ReadOnly[Annotated[int, "metadata"]]]


Aliased = TypedDict("Aliased", {"optional": A[R[N[int]], "metadata"], "required": R[A[Q[int], "metadata"]]})

optional: OptionalFields = {}
optional_class: OptionalFieldsClass = {}
aliased: Aliased = {"required": 1}


def optional_values(value: OptionalFields, class_value: OptionalFieldsClass) -> None:
    assert_type(value.get("key-0"), int | None)
    assert_type(class_value.get("key0"), int | None)
    assert_type(value.get("key-1"), int | None)
    assert_type(class_value.get("key1"), int | None)
    assert_type(value.get("key-2"), int | None)
    assert_type(class_value.get("key2"), int | None)
    assert_type(value.get("key-3"), int | None)
    assert_type(class_value.get("key3"), int | None)
    assert_type(value.get("key-4"), int | None)
    assert_type(class_value.get("key4"), int | None)
    assert_type(value.get("key-5"), int | None)
    assert_type(class_value.get("key5"), int | None)
    assert_type(value.get("key-6"), int | None)
    assert_type(class_value.get("key6"), int | None)
    assert_type(value.get("key-7"), int | None)
    assert_type(class_value.get("key7"), int | None)


def required_values(value: RequiredFields, class_value: RequiredFieldsClass, alias_value: Aliased) -> None:
    assert_type(value["key-0"], int)
    assert_type(class_value["key0"], int)
    assert_type(value["key-1"], int)
    assert_type(class_value["key1"], int)
    assert_type(value["key-2"], int)
    assert_type(class_value["key2"], int)
    assert_type(value["key-3"], int)
    assert_type(class_value["key3"], int)
    assert_type(value["key-4"], int)
    assert_type(class_value["key4"], int)
    assert_type(value["key-5"], int)
    assert_type(class_value["key5"], int)
    assert_type(value["key-6"], int)
    assert_type(class_value["key6"], int)
    assert_type(value["key-7"], int)
    assert_type(class_value["key7"], int)
    assert_type(alias_value.get("optional"), int | None)
    assert_type(alias_value["required"], int)


# Annotated also preserves the required-key context without a ReadOnly wrapper.
AnnotatedFields = TypedDict(
    "AnnotatedFields",
    {"optional": Annotated[NotRequired[int], "metadata"], "required": Annotated[Required[int], "metadata"]},
    total=False,
)
Quoted = TypedDict(
    "Quoted",
    {"optional": "ReadOnly[NotRequired[int]]", "required": "ReadOnly[Required[int]]"},
    total=False,
)

annotated_fields: AnnotatedFields = {"required": 1}
quoted_fields: Quoted = {"required": 1}


def annotated_and_quoted(value: AnnotatedFields, quoted: Quoted) -> None:
    assert_type(value.get("optional"), int | None)
    assert_type(value["required"], int)
    assert_type(quoted.get("optional"), int | None)
    assert_type(quoted["required"], int)


# Annotated metadata is evaluated as an ordinary expression, not a field type.
Metadata = TypedDict("Metadata", {"value": Annotated[int, NotRequired[str], Required[int], ReadOnly[float]]})
metadata: Metadata = {"value": 1}


def metadata_type(value: Metadata) -> None:
    assert_type(value["value"], int)
