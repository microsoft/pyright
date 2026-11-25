# This sample tests assignment of dataclass fields that use
# the converter parameter described in PEP 712.

from typing import Any, Callable, dataclass_transform


def converter_simple(s: str) -> int: ...


def converter_passThru(x: str | int) -> str | int: ...


def model_field(*, converter: Callable[..., Any], init: bool = True) -> Any: ...


@dataclass_transform(field_specifiers=(model_field,))
class ModelBase: ...


class DC1(ModelBase):
    asymmetric: int = model_field(converter=converter_simple)
    symmetric: str | int = model_field(converter=converter_passThru)


dc1 = DC1("1", 1)

reveal_type(dc1.asymmetric, expected_text="int")
dc1.asymmetric = "2"
reveal_type(
    dc1.asymmetric, expected_text="int"
)  # Asymmetric -- type narrowing should not occur
# This should generate an error because only strs can be assigned to field0.
dc1.asymmetric = 2

reveal_type(dc1.symmetric, expected_text="str | int")
dc1.symmetric = "1"
reveal_type(
    dc1.symmetric, expected_text="Literal['1']"
)  # Symmetric -- type narrowing should occur


reveal_type(DC1.asymmetric, expected_text="int")
# This should generate an error.
DC1.asymmetric = "2"
reveal_type(DC1.asymmetric, expected_text="int")
DC1.asymmetric = 2

reveal_type(DC1.symmetric, expected_text="str | int")
DC1.symmetric = "1"
reveal_type(DC1.symmetric, expected_text="Literal['1']")


class DC2(ModelBase):
    a: dict[str, str] = model_field(converter=dict)


DC2({})
DC2({"": ""})

# This should generate an error.
DC2({"": 1})


class DC3(ModelBase):
    b: tuple[int, ...] = model_field(converter=tuple)


DC3([1, 2, 3])

# This should generate an error.
DC3(["", 1])


class DC4(ModelBase):
    a: int = model_field(converter=converter_simple, init=False)


class DC5(ModelBase):
    a: int = model_field(converter=converter_simple)

    def __init__(self) -> None: ...


def func1(dc4: DC4):
    dc4.a = "1"


def func2(dc4: DC4):
    # This should generate an error.
    dc4.a = 1


def func3(dc5: DC5):
    dc5.a = "1"


def func4(dc5: DC5):
    # This should generate an error.
    dc5.a = 1
