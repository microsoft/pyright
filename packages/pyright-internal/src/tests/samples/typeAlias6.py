# This sample tests Pyright's handling of recursive type aliases.

from typing import List, TypeVar, Union

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
