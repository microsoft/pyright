# This sample tests the case where a dataclass converter is used with
# a generic type.

from typing import Any, Callable, dataclass_transform


def model_field(*, converter: Callable[..., Any]) -> Any: ...


@dataclass_transform(field_specifiers=(model_field,))
class ModelBase: ...


class DC1[T](ModelBase):
    data: set[T] = model_field(converter=set)


x = DC1([1, 2])
reveal_type(x, expected_text="DC1[int]")
reveal_type(x.data, expected_text="set[int]")
