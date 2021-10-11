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
