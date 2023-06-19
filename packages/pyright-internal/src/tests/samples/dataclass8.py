# This sample tests the type checker's ability to handle
# circular type references within dataclass definitions.

from dataclasses import dataclass


@dataclass
class ParentA:
    b: "ClassB"


@dataclass
class ChildA(ParentA):
    pass


@dataclass
class ClassB:
    sub_class: ChildA

    def method1(self):
        ChildA(b=self)
