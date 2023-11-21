# This sample tests handling of the @abc.abstractproperty decorator.

import abc


def requires_int(x: int):
    pass


class Foo(abc.ABC):
    @abc.abstractproperty
    def x(self) -> int:
        raise NotImplementedError

    @x.setter
    def x(self, value: int):
        raise NotImplementedError

    @abc.abstractproperty
    def y(self) -> float:
        raise NotImplementedError


a = Foo()
requires_int(a.x)

a.x = 3

# This should generate an error because a.y is not an int
requires_int(a.y)

# This should generate an error because the assigned type
# isn't compatible with the setter.
a.x = 4.5
