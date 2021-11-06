# This sample tests Pyright's handling of recursive type aliases.

from typing import Dict, List, TypeVar, Union

MyTree = List[Union["MyTree", int]]

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

Foo = Union[bool, List["Foo"], Dict["Foo", "Foo"]]

bar1: Foo = [True, [True, False]]
bar2: Foo = [True, [True], {True: False}]
bar3: Foo = {[True]: False}
bar4: Foo = {True: [False]}

# These should generate errors.
baz1: Foo = [True, ["True", False]]
baz2: Foo = [True, [True], {True: "False"}]
baz3: Foo = {["True"]: False}
baz4: Foo = {True: ["False"]}

Json = Union[None, int, str, float, List["Json"], Dict[str, "Json"]]

# This should generate an error
a1: Json = {"a": 1, "b": 3j}

# This should generate an error
a2: Json = [2, 3j]
