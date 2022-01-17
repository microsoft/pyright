# This sample verifies that metaclasses can be used to satisfy
# protocols if a class type is passed.

from enum import Enum


class Foo(str, Enum):
    bar = "bar"


for member in Foo:
    reveal_type(member, expected_text="Foo")

foo_members = list(Foo)
reveal_type(foo_members, expected_text="list[Foo]")
