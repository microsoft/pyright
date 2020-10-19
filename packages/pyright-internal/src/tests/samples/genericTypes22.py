# This sample tests the type checker's expansion of constrained
# TypeVars within a union type.

from typing import Union, AnyStr, Sequence


def do_the_thing(param: Union[Sequence[AnyStr], AnyStr]) -> None:
    if isinstance(param, str):
        print(f"str: {param}")
        return

    if isinstance(param, bytes):
        print(f"bytes: {param!r}")
        return

    print(f"list:")
    for itm in param:
        print(f"  -> {itm}")


do_the_thing("a")
do_the_thing(b"b")
do_the_thing(["a", "b"])
