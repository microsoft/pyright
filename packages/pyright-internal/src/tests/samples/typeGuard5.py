# This sample tests that uncertain metaclasses cannot justify class equality narrowing.

from typing import Any, assert_type, final


class EqualityMeta(type):
    def __eq__(cls, other: object) -> bool:
        return True

    def __ne__(cls, other: object) -> bool:
        return True


def make_meta(name: str, bases: tuple[type, ...], namespace: dict[str, object]) -> EqualityMeta:
    return EqualityMeta(name, bases, namespace)


@final
class FactoryClass(metaclass=make_meta):
    pass


class FactoryBase(metaclass=make_meta):
    pass


class FactoryMiddle(FactoryBase):
    pass


@final
class FactoryChild(FactoryMiddle):
    pass


class CallableMeta:
    def __call__(self, name: str, bases: tuple[type, ...], namespace: dict[str, object]) -> EqualityMeta:
        return make_meta(name, bases, namespace)


@final
class CallableClass(metaclass=CallableMeta()):
    pass


dynamic_meta: Any = EqualityMeta


@final
class DynamicClass(metaclass=dynamic_meta):
    pass


def unknown_base() -> Any:
    return EqualityMeta


class OpaqueMeta(unknown_base()):
    pass


@final
class OpaqueClass(metaclass=OpaqueMeta):
    pass


@final
class Plain:
    @classmethod
    def only_plain(cls) -> None:
        pass


@final
class Other:
    pass


def test_factory(cls: type[FactoryClass] | type[Plain]):
    if cls == Plain:
        assert_type(cls, type[FactoryClass] | type[Plain])
        # This should generate an error: FactoryClass can compare equal to Plain.
        cls.only_plain()
    else:
        assert_type(cls, type[FactoryClass])

    if cls != FactoryClass:
        assert_type(cls, type[FactoryClass] | type[Plain])
    else:
        assert_type(cls, type[FactoryClass] | type[Plain])


def test_inherited_factory(cls: type[FactoryChild] | type[Plain]):
    if cls == Plain:
        assert_type(cls, type[FactoryChild] | type[Plain])
        # This should generate an error: FactoryChild inherits the factory's metaclass.
        cls.only_plain()
    else:
        assert_type(cls, type[FactoryChild])

    if cls != FactoryChild:
        assert_type(cls, type[FactoryChild] | type[Plain])
    else:
        assert_type(cls, type[FactoryChild] | type[Plain])


def test_callable_object(cls: type[CallableClass] | type[Plain]):
    if cls == Plain:
        assert_type(cls, type[CallableClass] | type[Plain])
    else:
        assert_type(cls, type[CallableClass])

    if cls != CallableClass:
        assert_type(cls, type[CallableClass] | type[Plain])


def test_dynamic_meta(cls: type[DynamicClass] | type[Plain]):
    if cls == Plain:
        assert_type(cls, type[DynamicClass] | type[Plain])
    else:
        assert_type(cls, type[DynamicClass])

    if cls != Plain:
        assert_type(cls, type[DynamicClass])


def test_opaque_meta(cls: type[OpaqueClass] | type[Plain]):
    if cls == Plain:
        assert_type(cls, type[OpaqueClass] | type[Plain])
    else:
        assert_type(cls, type[OpaqueClass])

    if cls != OpaqueClass:
        assert_type(cls, type[OpaqueClass] | type[Plain])


def test_uncertain_rhs(cls: type[Plain] | type[Other]):
    if cls == FactoryClass:
        assert_type(cls, type[Plain] | type[Other])
    else:
        assert_type(cls, type[Plain] | type[Other])

    if cls != FactoryChild:
        assert_type(cls, type[Plain] | type[Other])

    if cls == DynamicClass:
        assert_type(cls, type[Plain] | type[Other])

    if cls != OpaqueClass:
        assert_type(cls, type[Plain] | type[Other])


class DefaultMeta(type):
    pass


@final
class DefaultClass(metaclass=DefaultMeta):
    pass


def test_known_default_meta(cls: type[DefaultClass] | type[Plain]):
    if cls == Plain:
        assert_type(cls, type[Plain])
    else:
        assert_type(cls, type[DefaultClass])

    if cls != DefaultClass:
        assert_type(cls, type[Plain])


def test_identity_unchanged(cls: type[FactoryClass] | type[Plain]):
    if cls is Plain:
        assert_type(cls, type[Plain])
    else:
        assert_type(cls, type[FactoryClass])
