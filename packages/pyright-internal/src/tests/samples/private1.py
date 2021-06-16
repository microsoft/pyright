# This sample tests the "reportPrivateUsage" feature.

from typing import NamedTuple
from .private2 import TestClass, _TestClass, TestClass as _Foo

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

a = _Foo()

# This should generate an error
c = b.__priv1


d = Foo()

# This should generate an error
e = d._my_var1

f = _Test


class TestSubclass(TestClass):
    def blah(self):
        return self._prot1

    def blah2(self):
        # This should generate an error
        return self.__priv1


class MyTuple(NamedTuple):
    field1: int
    field2: str


# This should not generate an error because _replace is declared
# within a stub file and is presumably part of the public interface
# contract.
MyTuple(1, "2")._replace(field1=3)
