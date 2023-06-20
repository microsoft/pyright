# This sample tests Pyright's handling of recursive type aliases.

from typing import Mapping, TypeVar, Union

MyTree = list[Union["MyTree", int]]

t1: MyTree = [1, 2, 3, [3, 4], [[3], 5]]

# This should generate an error because a str is not allowed.
t2: MyTree = [3, ""]

# This should generate an error because a str is not allowed.
t3: MyTree = [1, 2, 3, [3, 4], [3, 4, 5, [3, "4"]]]

_T = TypeVar("_T")
GenericUnion = Union[int, _T]

i1: GenericUnion[str] = "hi"
i1 = 3

i2: GenericUnion[float] = 3
# This should generate an error because str isn't compatible.
i2 = "hi"

Foo = Union[bool, list["Foo"], dict["Foo", "Foo"]]

bar1: Foo = [True, [True, False]]
bar2: Foo = [True, [True], {True: False}]
bar4: Foo = {True: [False]}

# These should generate errors.
baz1: Foo = [True, ["True", False]]
baz2: Foo = [True, [True], {True: "False"}]
baz4: Foo = {True: ["False"]}

Json = Union[None, int, str, float, list["Json"], dict[str, "Json"]]

# This should generate an error
a1: Json = {"a": 1, "b": 3j}

# This should generate an error
a2: Json = [2, 3j]

RecursiveTuple = Union[str | int, tuple["RecursiveTuple", ...]]


b1: RecursiveTuple = (1, 1)
b2: RecursiveTuple = (1, "1")
b3: RecursiveTuple = (1, "1", 1, "2")
b4: RecursiveTuple = (1, ("1", 1), "2")
b5: RecursiveTuple = (1, ("1", 1), (1, (1, 2)))

# This should generate an error
b6: RecursiveTuple = (1, ("1", 1), (1, (1, [2])))

# This should generate an error
b6: RecursiveTuple = (1, [1])


RecursiveMapping = Union[str, int, Mapping[str, "RecursiveMapping"]]


c1: RecursiveMapping = 1
c2: RecursiveMapping = "1"
c3: RecursiveMapping = {"1": "1"}
c4: RecursiveMapping = {"1": "1", "2": 1}
c5: RecursiveMapping = {"1": "1", "2": 1, "3": {}}
c6: RecursiveMapping = {"1": "1", "2": 1, "3": {"0": "0", "1": "2", "2": {}}}

# This should generate an error.
c7: RecursiveMapping = {"1": [1]}

# This should generate an error.
c8: RecursiveMapping = {"1": "1", "2": 1, "3": [1, 2]}

# This should generate an error.
c9: RecursiveMapping = {"1": "1", "2": 1, "3": {"0": "0", "1": 1, "2": [1, 2, 3]}}
