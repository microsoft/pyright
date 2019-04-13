# This sample tests the type checker's ability to check
# custom comparison operator overrides.

from typing import Union

class Foo(object):
    def __eq__(self, Foo):
        return 'equal'


class Bar(object):
    def __ne__(self, Bar):
        return self

    def __lt__(self, Bar):
        return 'string'

    def __gt__(self, Bar):
        return 'string'

    def __ge__(self, Bar):
        return 'string'

    def __le__(self, Bar):
        return 'string'

def needs_a_string(val: str):
    pass

def needs_a_string_or_bool(val: Union[bool, str]):
    pass

def test():
    a = Foo()
    needs_a_string(a == a)

    # This should generate an error because there
    # is no __ne__ operator defined, so a bool
    # value will result.
    needs_a_string(a != a)

    if True:
        a = Bar()

    # At this point, a should be of type Union[Foo, Bar],
    # so the == operator should return either a str or
    # a bool.
    needs_a_string_or_bool(a == a)

    # This should generate an error.
    needs_a_string(a == a)

    # This should generate an error.
    needs_a_string_or_bool(a != a)

    b = Bar()
    needs_a_string(b < b)
    needs_a_string(b > b)
    needs_a_string(b <= b)
    needs_a_string(b >= b)


