# This sample tests the handling of nested TypedDict fields.

from typing import TypedDict


class Inner1(TypedDict):
    inner_key: str


class Inner2(TypedDict):
    inner_key: Inner1


class Outer(TypedDict):
    outer_key: Inner2


o1: Outer = {"outer_key": {"inner_key": {"inner_key": "hi"}}}

# This should generate an error because the inner-most value
# should be a string.
o2: Outer = {"outer_key": {"inner_key": {"inner_key": 1}}}
