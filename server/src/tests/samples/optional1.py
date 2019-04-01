# This sample tests use of "Optional" types.

class Foo:
    def __init__(self):
        self.value = 3

    def do_stuff(self):
        pass

a = None
if 1:
    a = Foo()

# If "reportOptionalMemberAccess" is enabled,
# this should generate an error.
a.value = 3


def foo():
    pass

b = None
if 1:
    b = foo

# If "reportOptionalCall" is enabled,
# this should generate an error.
b()


c = None
if 1:
    c = [3, 4, 5]

# If "reportOptionalSubscript" is enabled,
# this should generate an error.
c[2]

