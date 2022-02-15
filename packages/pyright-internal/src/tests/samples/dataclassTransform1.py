# This sample tests the handling of the dataclass_transform mechanism
# when applied to a decorator function.

from typing import Any, Callable, TypeVar, overload
from typing_extensions import dataclass_transform

_T = TypeVar("_T")


@overload
@dataclass_transform(kw_only_default=True, order_default=True)
def create_model(cls: _T) -> _T:
    ...


@overload
@dataclass_transform(kw_only_default=True, order_default=True)
def create_model(
    *,
    frozen: bool = False,
    kw_only: bool = True,
    order: bool = True,
) -> Callable[[_T], _T]:
    ...


def create_model(*args: Any, **kwargs: Any) -> Any:
    ...


@create_model(kw_only=False, order=False)
class Customer1:
    id: int
    name: str


@create_model
class Customer2:
    id: int
    name: str


@create_model
class Customer2Subclass(Customer2, frozen=True):
    salary: float


c1_1 = Customer1(id=3, name="Sue")
c1_1.id = 4

c1_2 = Customer1(3, "Sue")
c1_2.name = "Susan"

# This should generate an error because of a type mismatch.
c1_2.name = 3

# This should generate an error because comparison methods are
# not synthesized.
v1 = c1_1 < c1_2

# This should generate an error because salary is not
# a defined field.
c1_3 = Customer1(id=3, name="Sue", salary=40000)

c2_1 = Customer2(id=0, name="John")

# This should generate an error because Customer2 supports
# keyword-only parameters for its constructor.
c2_2 = Customer2(0, "John")

v2 = c2_1 < c2_2
