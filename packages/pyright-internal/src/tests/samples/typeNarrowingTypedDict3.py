# This sample tests assignment-based narrowing for TypedDict values.

from typing import TypedDict


class MyDict1(TypedDict, total=False):
    key1: int
    key2: str


my_dict1: MyDict1 = {"key1": 1}
my_dict1["key1"]

# This should generate an error because "key2" isn't included in the
# narrowed type.
my_dict1["key2"]

if "key2" in my_dict1:
    my_dict1["key2"]


def read_present_keys(value: MyDict1):
    for key in ("key1", "key2"):
        if key in value:
            reveal_type(key, expected_text="Literal['key1', 'key2']")
            value[key]

            # This should generate an error because checking the variable key
            # doesn't prove that this specific key is present.
            value["key1"]


def read_present_or_undeclared_key(value: MyDict1):
    for key in ("key1", "missing"):
        if key in value:
            # This should generate an error for the undeclared key alternative.
            value[key]


class MutableDict(TypedDict, total=False):
    first: int
    second: int


def mutate_present_keys(value: MutableDict):
    for key in ("first", "second"):
        if key in value:
            value[key] = 1
            del value[key]


class IntValueDict(TypedDict, total=False):
    int_value: int


class StrValueDict(TypedDict, total=False):
    str_value: str


def read_present_key_from_union(value: IntValueDict | StrValueDict):
    for key in ("int_value", "str_value"):
        if key in value:
            reveal_type(value[key], expected_text="int* | str*")


class MyDict2(TypedDict, total=False):
    key3: MyDict1
    key4: MyDict1
    key5: MyDict1


my_dict2: MyDict2 = {"key3": {"key1": 3}, "key4": {}}

my_dict2["key3"]
my_dict2["key4"]

# This should generate an error because "key5" isn't included in the
# narrowed type.
my_dict2["key5"]

my_dict2["key3"]["key1"]

# This should generate an error because "key2" isn't included in the
# narrowed type.
my_dict2["key3"]["key2"]

# This should generate an error because "key4" isn't included in the
# narrowed type.
my_dict2["key4"]["key1"]
