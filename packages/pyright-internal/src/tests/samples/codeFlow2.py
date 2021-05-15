# This sample tests the case where a symbol that exists in
# an outer scope is redeclared within a class but is referenced
# within the class before it is declared.

import stat


class FakeOsModule(object):
    # The symbol "stat" is a module even though
    # it is redeclared below in this scope as
    # a method.
    _stat_mode: int = stat.S_IFDIR

    def stat(self):
        return None


def outer():
    a = 1

    def inner():
        # This should generate an error
        a += 1

    inner()
    return a
