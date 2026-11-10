# This sample tests raw method descriptors in class bodies and normal method binding.

from typing import Any, Callable, Concatenate, Protocol, Self, assert_type, overload


class HasFunc(Protocol):
    @property
    def __func__(self) -> Callable[..., Any]: ...


class ClassMethodProtocol[Cls, **P, R](Protocol):
    @property
    def __func__(self) -> Callable[Concatenate[type[Cls], P], R]: ...


class StaticMethodProtocol[**P, R](Protocol):
    @property
    def __func__(self) -> Callable[P, R]: ...


def accepts_descriptor(value: HasFunc) -> None: ...
def accepts_classmethod(value: classmethod) -> None: ...
def accepts_staticmethod(value: staticmethod) -> None: ...
def accepts_typed_classmethod(value: classmethod["Example", [int], str]) -> None: ...
def accepts_typed_staticmethod(value: staticmethod[[int], str]) -> None: ...
def accepts_protocols(cm: ClassMethodProtocol, sm: StaticMethodProtocol) -> None: ...
def unwrap[**P, R](value: StaticMethodProtocol[P, R]) -> Callable[P, R]:
    return value.__func__


class Example:
    @classmethod
    def cm(cls, value: int) -> str:
        return str(value)

    @staticmethod
    def sm(value: int) -> str:
        return str(value)

    @classmethod
    def typed_cm(cls: type["Example"], value: int) -> str:
        return str(value)

    accepts_descriptor(cm)
    accepts_descriptor(sm)
    accepts_classmethod(cm)
    accepts_staticmethod(sm)
    accepts_typed_classmethod(typed_cm)
    accepts_typed_staticmethod(sm)
    accepts_protocols(cm, sm)
    assert_type(sm.__func__(1), str)
    assert_type(sm.__wrapped__(1), str)
    assert_type(sm(1), str)
    assert_type(unwrap(sm)(1), str)
    saved_cm = cm
    saved_sm = sm
    accepts_descriptor(saved_cm)
    accepts_descriptor(saved_sm)

    @classmethod
    def create(cls) -> Self:
        return cls()

    saved_create = create

    @staticmethod
    @overload
    def convert(value: int) -> int: ...
    @staticmethod
    @overload
    def convert(value: str) -> str: ...
    @staticmethod
    def convert(value: int | str) -> int | str:
        return value

    accepts_descriptor(convert)
    assert_type(convert.__func__(1), int)
    assert_type(convert.__func__("a"), str)
    assert_type(convert.__wrapped__(1), int)
    assert_type(convert(1), int)
    assert_type(convert("a"), str)
    saved_convert = convert
    descriptors = (cm, sm, create, convert)

    @classmethod
    @overload
    def convert_cm(cls, value: int) -> int: ...
    @classmethod
    @overload
    def convert_cm(cls, value: str) -> str: ...
    @classmethod
    def convert_cm(cls, value: int | str) -> int | str:
        return value

    saved_convert_cm = convert_cm
    descriptor_cm = (convert_cm,)


assert_type(Example.cm(1), str)
assert_type(Example.sm(1), str)
assert_type(Example.saved_cm(1), str)
assert_type(Example.saved_sm(1), str)
assert_type(Example().cm(1), str)
assert_type(Example().sm(1), str)
assert_type(Example.saved_convert(1), int)
assert_type(Example.saved_convert("a"), str)


class Child(Example): ...


assert_type(Child.create(), Child)
assert_type(Child.saved_create(), Child)
assert_type(Example.descriptors[0].__func__(Child, 1), str)
assert_type(Example.descriptors[0].__wrapped__(Child, 1), str)
assert_type(Example.descriptors[2].__func__(Child), Child)
assert_type(Example.descriptors[2].__wrapped__(Child), Child)
assert_type(Example.descriptors[2].__get__(None, Child)(), Child)
assert_type(Example.descriptors[2].__get__(Child())(), Child)
assert_type(Example.descriptors[3].__get__(None, Child)(1), int)
assert_type(Example.descriptors[3].__get__(Child())("a"), str)
assert_type(Child.saved_convert_cm(1), int)
assert_type(Child().saved_convert_cm("a"), str)
assert_type(Example.descriptor_cm[0].__func__(Child, 1), int)
assert_type(Example.descriptor_cm[0].__wrapped__(Child, "a"), str)
assert_type(Example.descriptor_cm[0].__get__(None, Child)(1), int)


def function(value: int) -> str:
    return str(value)


def class_function(cls: type[Example], value: int) -> str:
    return str(value)


accepts_descriptor(classmethod(class_function))
accepts_descriptor(staticmethod(function))
assert_type(staticmethod(function)(1), str)
assert_type(staticmethod(function).__func__(1), str)


def bound_methods():
    cm = Example.cm
    sm = Example.sm
    assert_type(cm(1), str)
    assert_type(sm(1), str)


class Aliases:
    cm = Example.cm
    sm = Example.sm
    assert_type(cm(1), str)
    assert_type(sm(1), str)
