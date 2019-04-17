# This sample tests the "reportPrivateUsage" feature.

from .private2 import TestClass, _TestClass

_Test = 1

class Foo(object):
    _my_var1 = 1

    _my_var2 = _my_var1

    def foo(self):
        a = _Test
        return self._my_var1


# This should generate an error
a = _TestClass()

b = TestClass()

# This should generate an error
c = b._priv1


d = Foo()

# This should generate an error
e = d._my_var1

f = _Test



