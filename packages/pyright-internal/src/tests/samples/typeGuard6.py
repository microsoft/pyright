# This sample tests class equality guards with shared metaclasses and TypeVars.

from typing import Any, Generic, Never, TypeVar, assert_type, final


class DefaultMeta(type):
    pass


class InheritedMeta(DefaultMeta):
    pass


@final
class First(metaclass=InheritedMeta):
    pass


@final
class Second(metaclass=InheritedMeta):
    pass


@final
class Third(metaclass=InheritedMeta):
    pass


class Open(metaclass=InheritedMeta):
    pass


T = TypeVar("T")


@final
class GenericClass(Generic[T], metaclass=InheritedMeta):
    pass


def test_shared_meta(cls: type[First] | type[Second] | type[Third]):
    if cls == Second:
        assert_type(cls, type[Second])
    else:
        assert_type(cls, type[First] | type[Third])

    if cls != Third:
        assert_type(cls, type[First] | type[Second])
    else:
        assert_type(cls, type[Third])


def test_class_specific_checks(cls: type[First] | type[Open] | type[GenericClass[int]]):
    if cls == First:
        assert_type(cls, type[First] | type[Open] | type[GenericClass[int]])
    else:
        assert_type(cls, type[Open] | type[GenericClass[int]])


class CustomNeMeta(InheritedMeta):
    def __ne__(cls, other: object) -> bool:
        return False


@final
class CustomFirst(metaclass=CustomNeMeta):
    pass


@final
class CustomSecond(metaclass=CustomNeMeta):
    pass


def test_custom_shared_meta(cls: type[CustomFirst] | type[CustomSecond] | type[First]):
    if cls != First:
        assert_type(cls, type[CustomFirst] | type[CustomSecond])
    else:
        assert_type(cls, type[CustomFirst] | type[CustomSecond] | type[First])

    if cls == CustomFirst:
        assert_type(cls, type[CustomFirst] | type[CustomSecond] | type[First])


C = TypeVar("C", First, Second, Third)


def test_constraints(cls: type[C]):
    if cls == First:
        assert_type(cls, type[C])
    else:
        assert_type(cls, type[C])

    if cls != Second:
        assert_type(cls, type[C])
    else:
        assert_type(cls, type[C])

    if cls is First:
        assert_type(cls, type[C])


D = TypeVar("D", First, First)


def test_duplicate_constraints(cls: type[D]):
    if cls == First:
        assert_type(cls, type[D])


B = TypeVar("B", bound=First)


def test_final_bound(cls: type[B]):
    if cls == First:
        assert_type(cls, type[First])


A = TypeVar("A", First, Any)


def test_gradual_constraint(cls: type[A]):
    if cls == First:
        assert_type(cls, type[A])


N = TypeVar("N", First, Never)


def test_never_constraint(cls: type[N]):
    if cls == First:
        assert_type(cls, type[First])
