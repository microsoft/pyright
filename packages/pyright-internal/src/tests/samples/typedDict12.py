# This sample tests the synthesized methods get, setdefault
# pop, and __delitem__ for a TypedDict.

# pyright: strict

from typing import Optional, TypedDict, Union


class Foo(TypedDict, total=False):
    bar: str


foo: Foo = {}

v1: Optional[str] = foo.get("bar")

v2: str = foo.get("bar", "")
v3: Union[str, int] = foo.get("bar", 3)

v4: str = foo.setdefault("bar", "1")
v5: Union[str, int] = foo.setdefault("bar", 3)

v6: str = foo.pop("bar")
v7: str = foo.pop("bar", "none")
v8: Union[str, int] = foo.pop("bar", 3)

foo.__delitem__("bar")
