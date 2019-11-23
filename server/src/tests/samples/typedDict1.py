# This sample tests the type analyzer's handling of TypedDict classes.

from typing import Any, Dict, TypedDict

not_total = False

# This should generate an error because
# the value of the total argument must
# be a literal "True" or "False".
class TD1(TypedDict, total=not_total):
    pass


class TD2(TypedDict, total=False):
    """ This is a test """
    a: int

    # This should generate an error because "b"
    # is redeclared below with a different type.
    b: str

    b: float

    c: 'Dict[Any, Any]'

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

