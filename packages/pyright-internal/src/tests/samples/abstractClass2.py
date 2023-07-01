# This sample tests the cases where a mixin class
# overrides an abstract method, making it no longer abstract.

import abc


class InterfaceA(abc.ABC):
    @abc.abstractmethod
    def a(self) -> None:
        print("InterfaceA.a")


class MixinA(InterfaceA):
    def a(self) -> None:
        print("MixinA.a")


class InterfaceAB(InterfaceA):
    @abc.abstractmethod
    def b(self) -> None:
        print("InterfaceAB.b")


class ClassAB(InterfaceAB, MixinA):
    def b(self) -> None:
        print("ClassAB.b")


ab = ClassAB()
ab.a()
