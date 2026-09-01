# This sample tests the Python 3.10 additions to dataclass.

from dataclasses import dataclass, KW_ONLY, field


@dataclass
class DC1:
    a: str
    _: KW_ONLY
    b: int = 0


DC1("hi")
DC1(a="hi")
DC1(a="hi", b=1)
DC1("hi", b=1)

# This should generate an error because "b" is keyword-only.
DC1("hi", 1)


@dataclass
class DC2:
    b: int = field(kw_only=True, default=3)
    a: str


DC2("hi")
DC2(a="hi")
DC2(a="hi", b=1)
DC2("hi", b=1)

# This should generate an error because "b" is keyword-only.
DC2("hi", 1)


@dataclass(kw_only=True)
class DC3:
    a: str = field(kw_only=False)
    b: int = 0


DC3("hi")
DC3(a="hi")
DC3(a="hi", b=1)
DC3("hi", b=1)

# This should generate an error because "b" is keyword-only.
DC3("hi", 1)


@dataclass
class DC4(DC3):
    c: float


DC4("", 0.2, b=3)
DC4(a="", b=3, c=0.2)


# This tests that the KW_ONLY separator is recognized even when it
# is assigned to a name other than "_".
@dataclass
class DC5:
    a: str
    __: KW_ONLY
    b: int = 0


DC5("hi")
DC5(a="hi", b=1)
DC5("hi", b=1)

# This should generate an error because "b" is keyword-only.
DC5("hi", 1)


# This tests that a duplicate KW_ONLY separator is flagged. CPython raises a
# TypeError at runtime if more than one KW_ONLY separator appears.
@dataclass
class DC6:
    a: str
    _: KW_ONLY
    b: int = 0
    # This should generate an error because only one KW_ONLY separator is allowed.
    __: KW_ONLY
    c: int = 0


DC6("hi", b=1, c=2)
