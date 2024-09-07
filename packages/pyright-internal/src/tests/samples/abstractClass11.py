# This sample tests the handling of a class that is created from a subclass
# of ABCMeta.

from abc import ABCMeta, abstractmethod
from typing import final


class CustomMeta(ABCMeta):
    pass


class A(metaclass=CustomMeta):
    @abstractmethod
    def abstract(self):
        pass


@final
# This should generate an error.
class B(A):
    pass


# This should generate an error.
B()
