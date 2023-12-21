# This sample tests the handling of the @dataclass decorator.

from dataclasses import dataclass, InitVar


@dataclass
class DC1:
    bbb: int
    ccc: str
    aaa: str = "string"
    __hash__: None  # pyright: ignore[reportIncompatibleMethodOverride]


bar1 = DC1(bbb=5, ccc="hello")
bar2 = DC1(5, "hello")
bar3 = DC1(5, "hello", "hello2")
print(bar3.bbb)
print(bar3.ccc)
print(bar3.aaa)

# This should generate an error because ddd
# isn't a declared value.
bar = DC1(bbb=5, ddd=5, ccc="hello")

# This should generate an error because the
# parameter types don't match.
bar = DC1("hello", "goodbye")

# This should generate an error because a parameter
# is missing.
bar = [DC1(2)]

# This should generate an error because there are
# too many parameters.
bar = DC1(2, "hello", "hello", 4)


@dataclass
class DC2:
    bbb: int
    aaa: str = "string"

    # This should generate an error because variables
    # with no default cannot come after those with
    # defaults.
    ccc: str

    def __init__(self) -> None:
        pass


@dataclass
class DC3:
    aaa: str
    ddd: InitVar[int] = 3


@dataclass(init=False)
class DC4:
    bbb: int
    aaa: str = "string"
    # This should not generate an error because
    # the ordering requirement is not enforced when
    # init=False.
    ccc: str


@dataclass
class DC5:
    # Private names are not allowed, so this should
    # generate an error.
    __private: int


@dataclass
class DC6:
    x: type


DC6(int)

# This should generate an error.
DC6(1)
