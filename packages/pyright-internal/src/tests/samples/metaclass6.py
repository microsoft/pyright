# This sample verifies that metaclasses can be used to satisfy
# protocols if a class type is passed.

from enum import Enum
from typing import Literal


class Foo(str, Enum):
    bar = "bar"


for member in Foo:
    t1: Literal["Foo"] = reveal_type(member)

foo_members = list(Foo)
t2: Literal["list[Foo]"] = reveal_type(foo_members)
