# This sample tests the use of field's converter parameter
# described in PEP 712.

from typing import Any, Callable, dataclass_transform, overload


def model_field(*, converter: Callable[..., Any]) -> Any: ...


@dataclass_transform(field_specifiers=(model_field,))
class ModelBase: ...


def converter_simple(s: str) -> int:
    return int(s)


def converter_with_param_before_args(s: str, *args: int, **kwargs: int) -> int:
    return int(s)


def converter_with_args(*args: str) -> int:
    return int(args[0])


def converter_with_extra_defaulted_params(
    s: str, extra: int = 1, *, extraKwarg: int = 1
) -> int:
    return int(s)


def converter_with_default_for_first_param(s: str = "1") -> int:
    return int(s)


def converter_with_more_specialized_return_type(s: str) -> int:
    return int(s)


class ConverterClass:
    @overload
    def __init__(self, val: str) -> None: ...

    @overload
    def __init__(self, val: bytes) -> None: ...

    def __init__(self, val: str | bytes) -> None:
        pass


class DC1(ModelBase):
    field0: int = model_field(converter=converter_simple)
    field1: int = model_field(converter=converter_with_param_before_args)
    field2: int = model_field(converter=converter_with_args)
    field3: int = model_field(converter=converter_with_extra_defaulted_params)
    field4: int = model_field(converter=converter_with_default_for_first_param)
    field5: int | str = model_field(
        converter=converter_with_more_specialized_return_type
    )
    field6: ConverterClass = model_field(converter=ConverterClass)


reveal_type(
    DC1.__init__,
    expected_text="(self: DC1, field0: str, field1: str, field2: str, field3: str, field4: str, field5: str, field6: str | bytes) -> None",
)


# This overload will be ignored because it has too many arguments.
@overload
def overloaded_converter(s: float, secondParam: str, /) -> int: ...


# This overload will be ignored because its return type doesn't match the field type.
@overload
def overloaded_converter(s: float) -> str: ...


@overload
def overloaded_converter(s: str) -> int: ...


@overload
def overloaded_converter(s: list[str]) -> int: ...


def overloaded_converter(s: float | str | list[str], *args: str) -> int | float | str:
    return 0


class Overloads(ModelBase):
    field0: int = model_field(converter=overloaded_converter)


reveal_type(
    Overloads.__init__,
    expected_text="(self: Overloads, field0: str | list[str]) -> None",
)


class CallableObject:
    @overload
    def __call__(self, arg1: int) -> str: ...

    @overload
    def __call__(self, arg1: str) -> int: ...

    def __call__(self, arg1: str | int | list[str]) -> int | str:
        return 1


callable: Callable[[str], int] = converter_simple
callable_union: Callable[[str], int] | Callable[[int], str] = converter_simple


class Callables(ModelBase):
    field0: int = model_field(converter=CallableObject())
    field1: int = model_field(converter=callable)
    field2: int = model_field(converter=callable_union)


reveal_type(
    Callables.__init__,
    expected_text="(self: Callables, field0: str, field1: str, field2: str) -> None",
)


def wrong_return_type(s: str) -> str:
    return s


def wrong_number_of_params(x: str, x2: str, /) -> int:
    return 1


@overload
def wrong_converter_overload(s: float) -> str: ...


@overload
def wrong_converter_overload(s: str) -> str: ...


def wrong_converter_overload(s: float | str) -> int | str:
    return 1


class Errors(ModelBase):
    # This should generate an error because  the return type doesn't
    # match the field type.
    field0: int = model_field(converter=wrong_return_type)

    # This should generate an error because the converter has the
    # wrong number of parameters.
    field1: int = model_field(converter=wrong_number_of_params)

    # This should generate an error because none of the overloads
    # match the field type.
    field2: int = model_field(converter=wrong_converter_overload)
