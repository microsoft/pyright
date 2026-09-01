# This sample tests that KW_ONLY can be assigned to any variable name,
# not just `_`. Python docs state the name is ignored at runtime.
# See: https://docs.python.org/3/library/dataclasses.html#dataclasses.KW_ONLY

from dataclasses import KW_ONLY, dataclass


@dataclass
class DC1:
    a: int
    __: KW_ONLY
    b: str


DC1(1, b="hi")
DC1(a=1, b="hi")

# This should generate an error because "b" is keyword-only.
DC1(1, "hi")


@dataclass
class DC2:
    a: int = 0
    __: KW_ONLY
    b: str = "hi"


DC2(a=0, b="hi")
DC2(b="hi")

# This should generate an error because "b" is keyword-only.
DC2(0, "hi")


@dataclass
class DC3:
    a: int = 0
    kw_sep: KW_ONLY
    b: str = "hi"


DC3(a=0, b="hi")
DC3(b="hi")

# This should generate an error because "b" is keyword-only.
DC3(0, "hi")
