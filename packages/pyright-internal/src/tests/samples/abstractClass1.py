# This sample tests the type analyzer's ability to flag attempts
# to instantiate abstract base classes.

from abc import ABC, abstractmethod


class AbstractClassA(ABC):
    @abstractmethod
    def foo1(self):
        pass

    @abstractmethod
    def foo2(self):
        pass

    def foo3(self):
        return 3

    @classmethod
    def foo4(cls):
        # This should not generate an error even though
        # it would appear to be attempting to instantiate
        # an abstract class. That's because we need to
        # assume that the caller is making this call on
        # a non-abstract subclass.
        return cls()


v1 = [subclass() for subclass in AbstractClassA.__subclasses__()]
reveal_type(v1, expected_text="list[AbstractClassA]")


# This should generate an error because AbstractFoo
# is an abstract class.
a = AbstractClassA()


class AbstractClassB(AbstractClassA):
    def foo1(self):
        pass


# This should generate an error because AbstractBar1
# is an abstract class.
b = AbstractClassB()


class AbstractClassC(AbstractClassB):
    def foo2(self):
        pass


# This should not generate an error because AbstractBar2
# overrides all of the abstract methods it inherits.
c = AbstractClassC()
