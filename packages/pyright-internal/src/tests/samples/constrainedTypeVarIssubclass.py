# Tests when issubclass can narrow a constrained return TypeVar.

from typing import TypeVar, final

T = TypeVar("T", int, str)


def exact_filter[U: (int, str)](cls: type[U]) -> U:
    if issubclass(cls, int):
        return 1
    return ""


@final
class Exact: ...


class Other: ...


TFinal = TypeVar("TFinal", Exact, Other)


def final_filter(cls: type[TFinal], filter_cls: type[Exact]) -> TFinal:
    if issubclass(cls, filter_cls):
        return Exact()
    return Other()


class Base: ...


class Derived(Base): ...


TRelated = TypeVar("TRelated", Base, Derived)


def related_constraints(cls: type[TRelated]) -> TRelated:
    if issubclass(cls, Base):
        return Base()  # Error: TRelated could be Derived.
    return cls()


def shadowed_builtin():
    def issubclass(cls: type, filter_cls: type) -> bool:
        return True

    def select(cls: type[T]) -> T:
        if issubclass(cls, str):
            return ""  # Error: this function does not narrow T.
        return cls()


class FancyStr(str): ...


def dynamic_filter(cls: type[T], filter_cls: type[str]) -> T:
    if issubclass(cls, filter_cls):
        return cls()
    return 0  # Error: filter_cls could be FancyStr while cls is str.


class CustomMeta(type):
    def __subclasscheck__(cls, subclass: type, /) -> bool:
        return True


class CustomStr(str, metaclass=CustomMeta): ...


def custom_subclass_check(cls: type[T]) -> T:
    if issubclass(cls, CustomStr):
        return ""  # Error: the subclass hook can accept int.
    return cls()


class MetaA(type): ...


class MetaB(type): ...


class ClassA(metaclass=MetaA): ...


class ClassB(metaclass=MetaB): ...


TMeta = TypeVar("TMeta", MetaA, MetaB)


def bare_metaclass_type_var(cls: TMeta) -> TMeta:
    if issubclass(cls, MetaA):
        return ClassA  # Error: cls is not type[TMeta].
    return ClassB  # Error: cls is not type[TMeta].


TNumeric = TypeVar("TNumeric", float, str)


def promoted_constraint(cls: type[TNumeric]) -> TNumeric:
    if issubclass(cls, float):
        return 1.5
    return ""  # Error: int can solve as float but fails this subclass check.


class A: ...


class B: ...


class AB(A, B): ...


TOverlap = TypeVar("TOverlap", A, B)


def overlapping_constraints(cls: type[TOverlap]) -> TOverlap:
    if issubclass(cls, B):
        return B()  # Error: AB can solve as A and satisfy this subclass check.
    return A()
