# This sample tests type narrowing when comparing class types
# with equality (== and !=) operators against class objects.

from typing import Generic, TypeVar, assert_type, final


class Base:
    pass


class Sub1(Base):
    pass


@final
class Sub2(Base):
    pass


@final
class Sub3(Base):
    pass


T = TypeVar("T", bound=Base)


def test_eq_final(cls: type[Sub2] | type[Sub3]):
    if cls == Sub2:
        assert_type(cls, type[Sub2])
    else:
        assert_type(cls, type[Sub3])


def test_neq_final(cls: type[Sub2] | type[Sub3]):
    if cls != Sub3:
        assert_type(cls, type[Sub2])


def test_eq_open_hierarchy(cls: type[Base]):
    # A subclass of Base could use a metaclass with a custom __eq__,
    # so equality cannot narrow an open class hierarchy.
    if cls == Sub1:
        assert_type(cls, type[Base])


def test_eq_typevar(cls: type[T]):
    if cls == Sub2:
        assert_type(cls, type[T])


def test_neq_non_final(cls: type[Sub1] | type[Sub2]):
    if cls != Sub1:
        assert_type(cls, type[Sub1] | type[Sub2])


class CustomEqMeta(type):
    def __eq__(cls, other: object) -> bool:
        return True


class CustomNeMeta(type):
    def __ne__(cls, other: object) -> bool:
        return False


class EqualityMixin:
    def __eq__(self, other: object) -> bool:
        return True


class MixinMeta(type, EqualityMixin):
    pass


@final
class CustomEq(metaclass=CustomEqMeta):
    pass


@final
class CustomNe(metaclass=CustomNeMeta):
    pass


@final
class CustomMixin(metaclass=MixinMeta):
    pass


def test_eq_custom_meta_lhs(cls: type[CustomEq] | type[Sub2]):
    if cls == Sub2:
        assert_type(cls, type[CustomEq] | type[Sub2])


def test_ne_custom_meta_lhs(cls: type[CustomNe] | type[Sub2]):
    # The CustomNe alternative is retained; the Sub2 alternative uses
    # identity semantics and is eliminated.
    if cls != Sub2:
        assert_type(cls, type[CustomNe])


def test_eq_custom_meta_rhs(cls: type[Sub2] | type[Sub3]):
    if cls == CustomEq:
        assert_type(cls, type[Sub2] | type[Sub3])


def test_eq_inherited_custom_meta(cls: type[CustomMixin] | type[Sub2]):
    if cls == Sub2:
        assert_type(cls, type[CustomMixin] | type[Sub2])


def test_eq_instance_object(x: object):
    if x == Sub2:
        assert_type(x, object)


@final
class Box(Generic[T]):
    pass


def test_neq_generic(cls: type[Box[Sub1]]):
    if cls != Box[Sub2]:
        assert_type(cls, type[Box[Sub1]])
