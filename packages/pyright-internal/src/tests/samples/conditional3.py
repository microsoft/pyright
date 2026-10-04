# This sample tests that __bool__ can be called without arguments and returns bool.

from typing import Any, Callable, Generic, Literal, TypeVar


class BoolRequiresArgument:
    def __bool__(self, required: int) -> bool:
        return required > 0


class BoolMissingSelf:
    # This should generate a warning because an instance method needs a self parameter.
    def __bool__() -> bool:
        return True


class RequiresArgumentCallable:
    def __call__(self, required: int) -> bool:
        return required > 0


class BoolRequiresCallableArgument:
    __bool__ = RequiresArgumentCallable()


class BoolPropertyRequiresArgument:
    @property
    def __bool__(self) -> Callable[[int], bool]:
        return lambda value: value > 0


class BoolPropertyReturnsUnion:
    @property
    def __bool__(self) -> Callable[[], bool] | Callable[[], int]:
        return lambda: 1


class BoolPropertyArityUnion:
    @property
    def __bool__(self) -> Callable[[], bool] | Callable[[int], bool]:
        return lambda: True


class BoolIsIntConstructor:
    __bool__ = int


class BoolIsTypeConstructor:
    __bool__ = type


class TypeConstructorMeta(type):
    __bool__ = type


class ClassWithTypeConstructor(metaclass=TypeConstructorMeta):
    pass


class RequiresArgumentMeta(type):
    def __bool__(cls, required: int) -> bool:
        return required > 0


class ClassRequiresArgument(metaclass=RequiresArgumentMeta):
    pass


class BoolIsBoolConstructor:
    __bool__ = bool


class BoolPropertyValidUnion:
    @property
    def __bool__(self) -> Callable[[], Literal[True]] | Callable[[], Literal[False]]:
        return lambda: False


class ValidCallableUnion:
    @property
    def __call__(self) -> Callable[[], Literal[True]] | Callable[[], Literal[False]]:
        return lambda: True


class BoolIsValidCallableUnion:
    __bool__ = ValidCallableUnion()


class BoolConstructorMeta(type):
    __bool__ = bool


class ClassWithBoolConstructor(metaclass=BoolConstructorMeta):
    pass


TBool = TypeVar("TBool", bound=bool)


class GenericBoolUnion(Generic[TBool]):
    @property
    def __bool__(self) -> Callable[[], TBool] | Callable[[], Literal[False]]:
        return lambda: False


class GenericCallableUnion(Generic[TBool]):
    @property
    def __call__(self) -> Callable[[], TBool] | Callable[[], Literal[True]]:
        return lambda: True


class BoolIsGenericCallableUnion(Generic[TBool]):
    __bool__: GenericCallableUnion[TBool]


class BoolPropertyDynamicReturnUnion:
    @property
    def __bool__(self) -> Callable[[], bool] | Callable[[], Any]:
        return lambda: True


class BoolPropertyDynamicCallableUnion:
    @property
    def __bool__(self) -> Callable[[], bool] | Any:
        return lambda: True


def invalid_conditionals(
    required: BoolRequiresArgument,
    no_self: BoolMissingSelf,
    callable_instance: BoolRequiresCallableArgument,
    callable_property: BoolPropertyRequiresArgument,
    mixed_return: BoolPropertyReturnsUnion,
    mixed_arity: BoolPropertyArityUnion,
    int_constructor: BoolIsIntConstructor,
    type_constructor: BoolIsTypeConstructor,
):
    # This should generate an error.
    if required:
        pass
    # This should generate an error.
    if no_self:
        pass
    # This should generate an error.
    if callable_instance:
        pass
    # This should generate an error.
    if callable_property:
        pass
    # This should generate an error.
    if mixed_return:
        pass
    # This should generate an error.
    if mixed_arity:
        pass
    # This should generate an error.
    if int_constructor:
        pass
    # This should generate an error.
    if type_constructor:
        pass
    # This should generate an error.
    if ClassWithTypeConstructor:
        pass
    # This should generate an error.
    if ClassRequiresArgument:
        pass


def valid_conditionals(
    constructor: BoolIsBoolConstructor,
    descriptor: BoolPropertyValidUnion,
    callable_union: BoolIsValidCallableUnion,
    generic: GenericBoolUnion[TBool],
    generic_callable: BoolIsGenericCallableUnion[TBool],
    dynamic_return: BoolPropertyDynamicReturnUnion,
    dynamic_callable: BoolPropertyDynamicCallableUnion,
):
    if constructor:
        pass
    if descriptor:
        pass
    if callable_union:
        pass
    if ClassWithBoolConstructor:
        pass
    if generic:
        pass
    if generic_callable:
        pass
    if dynamic_return:
        pass
    if dynamic_callable:
        pass
