# This sample tests for duplicate base class detection.

from typing import Generic, TypeVar


T = TypeVar("T")


class BaseClass(Generic[T]):
    pass


IntBaseClass = BaseClass[float]


# This should generate an error because the same
# base class is used twice.
class SubClass(BaseClass[float], IntBaseClass):
    pass
