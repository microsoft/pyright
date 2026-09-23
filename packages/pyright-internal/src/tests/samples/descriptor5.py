# This sample tests that assignment through an inherited asymmetric descriptor
# does not narrow subsequent reads to the setter's input type.

from typing import Any, Literal, Self, assert_type, cast, overload


class Getter[T]:
    def __get__(self, instance: Any, owner: Any = None) -> T:
        return cast(Any, None)


class Descriptor[T, U](Getter[T]):
    def __set__(self, instance: Any, value: T | U) -> None:
        pass


class IntFromStr(Descriptor[int, str]):
    pass


class Container:
    value: IntFromStr


container = Container()
container.value = "1"
assert_type(container.value, int)


class SetterBase:
    def __get__(self, instance: Any, owner: Any = None) -> int | str:
        return cast(Any, None)

    def __set__(self, instance: Any, value: int | str) -> None:
        pass


class GetterOverride(SetterBase):
    def __get__(self, instance: Any, owner: Any = None) -> int:
        return 0


class OverrideContainer:
    value: GetterOverride


override_container = OverrideContainer()
override_container.value = "1"
assert_type(override_container.value, int)


class AsymmetricProperty:
    @property
    def value(self) -> int:
        return 0

    @value.setter
    def value(self, new_value: str) -> None:
        pass


prop = AsymmetricProperty()
prop.value = "1"
assert_type(prop.value, int)


# Regression test for an instance attribute named __get__ not shadowing the
# class-level descriptor accessor during asymmetry detection.
class IntGetterStrSetter:
    def __get__(self, obj: object, owner: object = None) -> int:
        return 42

    def __set__(self, obj: object, value: str) -> None:
        pass


class ShadowedGetter(IntGetterStrSetter):
    def __init__(self) -> None:
        self.__get__: Any = None


class ShadowedGetterContainer:
    value: ShadowedGetter = ShadowedGetter()


shadowed = ShadowedGetterContainer()
shadowed.value = "text"
assert_type(shadowed.value, int)


# Regression test for inherited generic accessors that use Self.
class SelfDescriptor:
    stored: Self

    def __get__(self, obj: object, owner: object = None) -> Self:
        return self.stored

    def __set__(self, obj: object, value: Self) -> None:
        self.stored = value


class SelfSetterOverride(SelfDescriptor):
    def __set__(self, obj: object, value: Self) -> None:  # pyright: ignore[reportIncompatibleMethodOverride]
        super().__set__(obj, value)


class SelfValue(SelfSetterOverride):
    def extra(self) -> int:
        return 42


class SelfContainer:
    value: SelfSetterOverride = SelfSetterOverride()


self_container = SelfContainer()
self_container.value = SelfValue()
assert_type(self_container.value, SelfValue)
self_container.value.extra()


# Sibling-mixin / diamond inheritance where accessors come from different branches.
class DiamondGetterMixin:
    def __get__(self, instance: Any, owner: Any = None) -> int:
        return 42


class DiamondSetterMixin:
    def __set__(self, instance: Any, value: str) -> None:
        pass


class DiamondDescriptor(DiamondGetterMixin, DiamondSetterMixin):
    pass


class DiamondContainer:
    value: DiamondDescriptor = DiamondDescriptor()


diamond = DiamondContainer()
diamond.value = "text"
assert_type(diamond.value, int)


# Symmetric inherited descriptor preserves assignment narrowing.
class SymmetricGetterBase:
    def __get__(self, instance: Any, owner: Any = None) -> int | str:
        return cast(Any, None)


class SymmetricInheritedDescriptor(SymmetricGetterBase):
    def __set__(self, instance: Any, value: int | str) -> None:
        pass


class SymmetricContainer:
    value: SymmetricInheritedDescriptor = SymmetricInheritedDescriptor()


sym = SymmetricContainer()
sym.value = "narrowed"
assert_type(sym.value, Literal["narrowed"])


# Multiple specializations of the same generic descriptor without cross-instance leakage.
class GenericAsymmetricDesc[G, S]:
    def __get__(self, instance: Any, owner: Any = None) -> G:
        return cast(Any, None)

    def __set__(self, instance: Any, value: S) -> None:
        pass


class DualSpecializationContainer:
    first: GenericAsymmetricDesc[int, str] = GenericAsymmetricDesc()
    second: GenericAsymmetricDesc[float, bytes] = GenericAsymmetricDesc()


dual = DualSpecializationContainer()
dual.first = "first"
assert_type(dual.first, int)

dual.second = b"second"
assert_type(dual.second, float)


# Generic descriptor used through a generic container.
class GenericContainer[T]:
    item: Descriptor[T, str]


gen_container: GenericContainer[int] = GenericContainer()
gen_container.item = "item"
assert_type(gen_container.item, int)


# Inherited overloaded accessors.
class OverloadedGetterBase:
    @overload
    def __get__(self, instance: None, owner: Any) -> Self: ...
    @overload
    def __get__(self, instance: object, owner: Any) -> int: ...
    def __get__(self, instance: object | None, owner: Any = None) -> Any:
        return cast(Any, None)


class OverloadedDescriptor(OverloadedGetterBase):
    def __set__(self, instance: object, value: str) -> None:
        pass


class OverloadedContainer:
    value: OverloadedDescriptor = OverloadedDescriptor()


overloaded = OverloadedContainer()
overloaded.value = "test"
assert_type(overloaded.value, int)
assert_type(OverloadedContainer.value, OverloadedDescriptor)


# Rejection of invalid setter inputs.
container.value = 1.23  # pyright: ignore[reportAttributeAccessIssue]
diamond.value = 123  # pyright: ignore[reportAttributeAccessIssue]
overloaded.value = 123  # pyright: ignore[reportAttributeAccessIssue]
