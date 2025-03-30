# This sample tests the check for abstract methods on a final class.

from typing import final
from abc import ABC, abstractmethod


class Foo(ABC):
    @abstractmethod
    def foo(self):
        pass


class Bar(Foo):
    @abstractmethod
    def bar(self):
        pass

    @abstractmethod
    def bar2(self):
        pass


@final
# This should generate an error because Foo.foo, Bar.bar, and Bar.bar1
# are abstract.
class Baz(Bar): ...
