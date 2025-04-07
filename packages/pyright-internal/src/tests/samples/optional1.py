# This sample tests use of "Optional" types.

from typing import Any, Optional


class Foo:
    def __init__(self):
        self.value = 3

    def do_stuff(self):
        pass

    def __enter__(self):
        return 3

    def __exit__(
        self,
        t: Optional[type] = None,
        exc: Optional[BaseException] = None,
        tb: Optional[Any] = None,
    ) -> bool:
        return True


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


# If "reportOptionalIterable" is enabled,
# this should generate an error.
for val in c:
    pass

# If "reportOptionalContextManager" is enabled,
# this should generate an error.
cm = None
if 1:
    cm = Foo()
with cm as val:
    pass

e = None
if 1:
    e = 4

# If "reportOptionalOperand" is enabled,
# this should generate an error.
v1 = e + 4

# If "reportOptionalOperand" is enabled,
# this should generate an error.
v2 = e < 5

# If "reportOptionalOperand" is enabled,
# this should generate an error.
v3 = ~e
