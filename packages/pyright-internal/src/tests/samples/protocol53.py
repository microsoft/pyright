# This sample tests protocol matching and override compatibility checks
# for cases involving `Self`.

from typing import Protocol, Self


class Proto_CoRecurs(Protocol):
    def m(self) -> "Proto_CoRecurs": ...


class Proto_CoSelf(Protocol):
    def m(self) -> Self: ...


class Proto_CoGeneric(Protocol):
    def m[T: Proto_CoGeneric](self: T) -> T: ...


class Impl_CoRecurs:
    def m(self) -> "Impl_CoRecurs": ...


class Impl_CoSelf:
    def m(self) -> Self: ...


class Impl_CoGeneric:
    def m[T: Impl_CoGeneric](self: T) -> T: ...


class Impl_CoOther:
    def m(self) -> Impl_CoSelf: ...


class Impl_CoRecursExplicit1(Proto_CoRecurs):
    def m(self) -> "Impl_CoRecursExplicit1": ...


class Impl_CoSelfExplicit1(Proto_CoRecurs):
    def m(self) -> Self: ...


class Impl_CoGenericExplicit1(Proto_CoRecurs):
    def m[T: Impl_CoGenericExplicit1](self: T) -> T: ...


class Impl_CoOtherExplicit1(Proto_CoRecurs):
    def m(self) -> Impl_CoSelf: ...


class Impl_CoRecursExplicit2(Proto_CoSelf):
    def m(self) -> "Impl_CoRecursExplicit2": ...


class Impl_CoSelfExplicit2(Proto_CoSelf):
    def m(self) -> Self: ...


class Impl_CoGenericExplicit2(Proto_CoSelf):
    def m[T: Impl_CoGenericExplicit2](self: T) -> T: ...


class Impl_CoOtherExplicit2(Proto_CoSelf):
    # This should generate a reportIncompatibleMethodOverride error.
    def m(self) -> Impl_CoSelf: ...


class Impl_CoRecursExplicit3(Proto_CoGeneric):
    def m(self) -> "Impl_CoRecursExplicit3": ...


class Impl_CoSelfExplicit3(Proto_CoGeneric):
    def m(self) -> Self: ...


class Impl_CoGenericExplicit3(Proto_CoGeneric):
    def m[T: Impl_CoGenericExplicit3](self: T) -> T: ...


class Impl_CoOtherExplicit3(Proto_CoGeneric):
    # This should generate a reportIncompatibleMethodOverride error
    # but does not currently.
    def m(self) -> Impl_CoSelf: ...


x01: Proto_CoRecurs = Impl_CoRecurs()
x02: Proto_CoRecurs = Impl_CoSelf()
x03: Proto_CoRecurs = Impl_CoGeneric()
x04: Proto_CoRecurs = Impl_CoOther()

x11: Proto_CoSelf = Impl_CoRecurs()
x12: Proto_CoSelf = Impl_CoSelf()
x13: Proto_CoSelf = Impl_CoGeneric()
# This should generate a reportAsignmentType error.
x14: Proto_CoSelf = Impl_CoOther()

x21: Proto_CoGeneric = Impl_CoRecurs()
x22: Proto_CoGeneric = Impl_CoSelf()
x23: Proto_CoGeneric = Impl_CoGeneric()
# This should generate a reportAsignmentType error.
x24: Proto_CoGeneric = Impl_CoOther()


class Proto_ContraRecurs(Protocol):
    def m(self, x: "Proto_ContraRecurs") -> None: ...


class Proto_ContraSelf(Protocol):
    def m(self, x: Self) -> None: ...


class Proto_ContraGeneric(Protocol):
    def m[T: Proto_ContraGeneric](self: T, x: T) -> None: ...


class Impl_ContraRecurs:
    def m(self, x: "Impl_ContraRecurs") -> None: ...


class Impl_ContraSelf:
    def m(self, x: Self) -> None: ...


class Impl_ContraGeneric:
    def m[T: Impl_ContraGeneric](self: T, x: T) -> None: ...


class Impl_ContraOther:
    def m(self, x: Impl_ContraSelf) -> None: ...


class Impl_ContraRecursExplicit1(Proto_ContraRecurs):
    # This should generate a reportIncompatibleMethodOverride error.
    def m(self, x: "Impl_ContraRecursExplicit1") -> None: ...


class Impl_ContraSelfExplicit1(Proto_ContraRecurs):
    # This should generate a reportIncompatibleMethodOverride error.
    def m(self, x: Self) -> None: ...


class Impl_ContraGenericExplicit1(Proto_ContraRecurs):
    # This should generate a reportIncompatibleMethodOverride error.
    def m[T: Impl_ContraGenericExplicit1](self: T, x: T) -> None: ...


class Impl_ContraOtherExplicit1(Proto_ContraRecurs):
    # This should generate a reportIncompatibleMethodOverride error.
    def m(self, x: Impl_ContraSelf) -> None: ...


class Impl_ContraRecursExplicit2(Proto_ContraSelf):
    def m(self, x: "Impl_ContraRecursExplicit2") -> None: ...


class Impl_ContraSelfExplicit2(Proto_ContraSelf):
    def m(self, x: Self) -> None: ...


class Impl_ContraGenericExplicit2(Proto_ContraSelf):
    def m[T: Impl_ContraGenericExplicit2](self: T, x: T) -> None: ...


class Impl_ContraOtherExplicit2(Proto_ContraSelf):
    # This should generate a reportIncompatibleMethodOverride error.
    def m(self, x: Impl_ContraSelf) -> None: ...


class Impl_ContraRecursExplicit3(Proto_ContraGeneric):
    # This should not generate a reportIncompatibleMethodOverride error
    # but does currently.
    def m(self, x: "Impl_ContraRecursExplicit3") -> None: ...


class Impl_ContraSelfExplicit3(Proto_ContraGeneric):
    # This should not generate a reportIncompatibleMethodOverride error
    # but does currently.
    def m(self, x: Self) -> None: ...


class Impl_ContraGenericExplicit3(Proto_ContraGeneric):
    # This should not generate a reportIncompatibleMethodOverride error
    # but does currently.
    def m[T: Impl_ContraGenericExplicit3](self: T, x: T) -> None: ...


class Impl_ContraOtherExplicit3(Proto_ContraGeneric):
    # This should not generate a reportIncompatibleMethodOverride error
    # but does currently.
    def m(self, x: Impl_ContraSelf) -> None: ...


# This should generate a reportAsignmentType error.
y01: Proto_ContraRecurs = Impl_ContraRecurs()
# This should generate a reportAsignmentType error.
y02: Proto_ContraRecurs = Impl_ContraSelf()
# This should generate a reportAsignmentType error.
y03: Proto_ContraRecurs = Impl_ContraGeneric()
# This should generate a reportAsignmentType error.
y04: Proto_ContraRecurs = Impl_ContraOther()

y11: Proto_ContraSelf = Impl_ContraRecurs()
y12: Proto_ContraSelf = Impl_ContraSelf()
y13: Proto_ContraSelf = Impl_ContraGeneric()
# This should generate a reportAsignmentType error.
y14: Proto_ContraSelf = Impl_ContraOther()

y21: Proto_ContraGeneric = Impl_ContraRecurs()
y22: Proto_ContraGeneric = Impl_ContraSelf()
y23: Proto_ContraGeneric = Impl_ContraGeneric()
# This should generate a reportAsignmentType error.
y24: Proto_ContraGeneric = Impl_ContraOther()
