# This sample tests negative type narrowing for tuple membership checks (in / not in)
# containing instantiable class objects (type[T]).

from typing_extensions import assert_type

class ClassA: pass
class ClassB: pass
class ClassC: pass

def test_in_class_tuple(x: type[ClassA] | type[ClassB] | type[ClassC]):
    if x in (ClassA, ClassB):
        assert_type(x, type[ClassA] | type[ClassB])
    else:
        assert_type(x, type[ClassC])

def test_not_in_class_tuple(x: type[ClassA] | type[ClassB] | type[ClassC]):
    if x not in (ClassA, ClassB):
        assert_type(x, type[ClassC])
    else:
        assert_type(x, type[ClassA] | type[ClassB])
