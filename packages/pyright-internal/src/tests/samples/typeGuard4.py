# This sample tests type narrowing when comparing class types
# with equality (== and !=) operators against class objects.

from typing import TypeVar, assert_type, final

class Base: pass
class Sub1(Base): pass

@final
class Sub2(Base): pass

T = TypeVar("T", bound=Base)

def test_eq_concrete(cls: type[Base]) -> type[Sub1]:
    if cls == Sub1:
        assert_type(cls, type[Sub1])
        return cls
    raise ValueError()

def test_neq_concrete(cls: type[Sub1] | type[Sub2]):
    if cls != Sub2:
        assert_type(cls, type[Sub1])

def test_neq_non_final(cls: type[Sub1] | type[Sub2]):
    if cls != Sub1:
        assert_type(cls, type[Sub1] | type[Sub2])

def test_eq_typevar(cls: type[T]) -> type[Sub1]:
    if cls == Sub1:
        assert_type(cls, type[Sub1])
        return cls
    raise ValueError()

class CustomMeta(type):
    def __eq__(cls, other: object) -> bool:
        return True

class Custom1(metaclass=CustomMeta): pass
class Custom2(metaclass=CustomMeta): pass

def test_eq_custom_meta(cls: type[Custom1] | type[Custom2]):
    if cls == Custom1:
        assert_type(cls, type[Custom1] | type[Custom2])

class EqualityDummy:
    def __eq__(self, other: object) -> bool:
        return True

def test_eq_instance_object(x: object):
    if x == Sub1:
        assert_type(x, object)
