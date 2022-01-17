# This sample tests the type checker's handling of ClassVar
# used within a Protocol, as specified in PEP 544.

import typing as t
from typing import ClassVar as _ClassVar


class Proto(t.Protocol):
    var1: t.ClassVar[str]
    var2: t.ClassVar[str]
    var3: _ClassVar = ["hi"]


class ProtoImpl:
    var1 = ""

    def __init__(self) -> None:
        self.var2 = ""


# This should generate an error because var2
# is not a class variable.
a: Proto = ProtoImpl()


def func1(x: Proto):
    reveal_type(x.var1, expected_text="str")
    reveal_type(x.var2, expected_text="str")
    reveal_type(x.var3, expected_text="list[str]")
