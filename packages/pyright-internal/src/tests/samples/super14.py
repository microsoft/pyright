# This sample tests that attribute mutation applies to a super proxy itself,
# rather than to the bound object, even when the base defines a writable member.

import builtins
from typing import Callable


class Inner:
    value: int = 0


class Base:
    value: int = 1
    inner: Inner = Inner()
    values: list[int] = [1]

    @property
    def prop(self) -> int:
        return self.value

    @prop.setter
    def prop(self, value: int) -> None:
        self.value = value

    @prop.deleter
    def prop(self) -> None:
        self.value = 0

    def method(self) -> int:
        return self.value


class Child(Base):
    def invalid(self) -> None:
        # This should generate an error.
        super().value = 2

        # This should generate an error.
        super().prop = 2

        # This should generate an error.
        super(Child, self).value = 2

        # This should generate an error.
        super().value += 2

        # This should generate an error.
        super().prop += 2

        # This should generate an error.
        del super().value

        # This should generate an error.
        del super().prop

    def valid(self) -> None:
        reveal_type(super().value, expected_text="int")
        reveal_type(super().prop, expected_text="int")
        reveal_type(super().method(), expected_text="int")
        super().inner.value = 2
        super().inner.value += 2
        del super().inner.value
        super().values[0] = 2
        del super().values[0]
        super().__setattr__("value", 2)
        super().__delattr__("value")
        self.value = 2
        self.prop = 2

    def shadowed(self, super: Callable[[], Inner]) -> None:
        super().value = 2
        super().value += 2
        del super().value

    def __setattr__(self, name: str, value: object) -> None:
        object.__setattr__(self, name, value)

    def __delattr__(self, name: str) -> None:
        object.__delattr__(self, name)


# This should generate an error.
super(Child, Child()).value = 3


class WritableSuper(super):
    value: int = 0


def writable_super(obj: Child) -> None:
    proxy = WritableSuper(Child, obj)
    proxy.value = 2
    proxy.value += 2
    del proxy.value
    WritableSuper(Child, obj).value = 2


def possibly_writable_super(super: type[builtins.super], obj: Child) -> None:
    # The callee may be a writable subclass rather than the exact builtin.
    super(Child, obj).value = 2
    super(Child, obj).value += 2
    del super(Child, obj).value
