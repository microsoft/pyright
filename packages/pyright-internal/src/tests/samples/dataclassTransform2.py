# This sample tests the handling of the dataclass_transform mechanism
# when applied to a metaclass.

from typing import Any, Optional, TypeVar
from typing_extensions import dataclass_transform

_T = TypeVar("_T")


class ModelField:
    def __init__(self, *, init: bool = True, default: Optional[Any] = None) -> None:
        ...


def model_field(
    *, init: bool = True, default: Optional[Any] = None, alias: Optional[str] = None
) -> Any:
    ...


@dataclass_transform(
    kw_only_default=True,
    field_descriptors=(ModelField, model_field),
)
class ModelMeta(type):
    def __init_subclass__(
        cls,
        *,
        frozen: bool = False,
        kw_only: bool = True,
        order: bool = True,
    ) -> None:
        ...


class ModelBase(metaclass=ModelMeta):
    ...


class Customer1(ModelBase, frozen=True):
    id: int = model_field()
    name: str = model_field()
    name2: str = model_field(alias="other_name", default="None")


class Customer1Subclass(Customer1, frozen=False):
    salary: float = model_field()


class Customer2(ModelBase, order=True):
    id: int
    name: str = model_field(default="None")


c1_1 = Customer1(id=3, name="Sue", other_name="Susan")

# This should generate an error because the class is frozen.
c1_1.id = 4

# This should generate an error because the class is kw_only.
c1_2 = Customer1(3, "Sue")

# This should generate an error because other_name is missing.
c1_3 = Customer1(id=3, name="John")

# This should generate an error because comparison methods are
# not synthesized.
v1 = c1_1 < c1_2

c2_1 = Customer2(id=0, name="John")

c2_2 = Customer2(id=1)

v2 = c2_1 < c2_2

# This should generate an error because Customer2 supports
# keyword-only parameters for its constructor.
c2_3 = Customer2(0, "John")
