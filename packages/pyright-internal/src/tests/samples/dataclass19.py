# This sample tests that overriding a dataclass field with field()
# and no default does not inherit the parent default.

from dataclasses import dataclass, field


@dataclass
class Base:
    x: int = 1


@dataclass
class Foo(Base):
    # This should not generate an error. field() with no default
    # removes the inherited default at runtime.
    x: int = field()


# This should generate an error because x is required.
Foo()

foo = Foo(2)
reveal_type(foo.x, expected_text="int")


@dataclass
class Base2:
    a: int = 0


@dataclass
class BareOverride(Base2):
    # This should generate an error because a bare annotation still
    # inherits the parent default at runtime.
    a: int

    # This should generate an error because a still has a default.
    b: str


@dataclass
class Base3:
    a: int = 0
    b: int = 1


@dataclass
class OrderOverride(Base3):
    # This should generate an error because "b" loses its inherited default
    # and would then follow "a", which still has one. At runtime this is a
    # TypeError raised when the class is created.
    b: int = field()


@dataclass
class Base4:
    a: int = 0


@dataclass
class InitFalseOverride(Base4):
    # field(init=False) removes the parameter from __init__ rather than
    # dropping the inherited default, so the attribute keeps the base value.
    a: int = field(init=False)


reveal_type(InitFalseOverride.__init__, expected_text="(self: InitFalseOverride) -> None")
reveal_type(InitFalseOverride().a, expected_text="int")
