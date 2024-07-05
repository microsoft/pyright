# This sample tests the type analyzer's handling of TypedDict classes.

from typing import Any, TypeVar, TypedDict

not_total = False


# This should generate an error because
# the value of the total argument must
# be a literal "True" or "False".
class TD1(TypedDict, total=not_total):
    pass


class TD2(TypedDict, total=False):
    """This is a test"""

    a: int

    # This should generate an error because "b"
    # is redeclared below with a different type.
    b: str

    b: float

    c: "dict[Any, Any]"

    # This should generate an error because
    # assignments are not allowed.
    d: float = 3.0

    # This should generate an error because
    # methods are not allowed.
    def foo(self):
        pass


class TD3(TypedDict, total=True):
    a: int
    b: float
    c: str


class TD4(TypedDict):
    d: str


class TD5(TD3, total=False):
    e: str

    # This should generate an error because
    # methods are not allowed.
    def foo(self):
        pass


class NotATD:
    pass


# This should generate an error because non-TypeDict
# base classes shouldn't be allowed for TD classes.
class TD6(TD3, NotATD):
    pass


# This should generate an error because non-TypeDict
# base classes shouldn't be allowed for TD classes.
class TD7(NotATD, TypedDict):
    pass


# This should generate an error because TypedDict can't
# be used in a type annotation.
v1: TypedDict | int

# This should generate an error because TypedDict can't
# be used in a TypeVar bound.
T = TypeVar("T", bound=TypedDict | int)


# This should generate an error because TypedDict doesn't support
# a metaclass parameter.
class TD8(TypedDict, metaclass=type):
    name: str


# This should generate an error because TypedDict doesn't support
# other __init_subclass__ parameters.
class TD9(TypedDict, other=True):
    name: str
