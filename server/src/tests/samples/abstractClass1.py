# This sample tests the type analyzer's ability to flag attempts
# to instantiate abstract base classes.

from abc import ABC, abstractmethod

class AbstractFoo(ABC):
    @abstractmethod
    def foo1(self):
        pass

    @abstractmethod
    def foo2(self):
        pass

    def foo3(self):
        return 3


# This should generate an error because AbstractFoo
# is an abstract class.
a = AbstractFoo()

class AbstractBar1(AbstractFoo):
    def foo1(self):
        pass

# This should generate an error because AbstractBar1
# is an abstract class.
b = AbstractBar1()

class AbstractBar2(AbstractBar1):
    def foo2(self):
        pass

# This should not generate an error because AbstractBar2
# overrides all of the abstract methods it inherits.
c = AbstractBar2()


