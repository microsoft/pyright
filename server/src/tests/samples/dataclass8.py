# This sample tests the type checker's ability to handle
# circular type references within dataclass definitions.

from dataclasses import dataclass

@dataclass
class BaseClass:
    my_ref: "ReferredClass"


@dataclass
class SubClass(BaseClass):
    pass


@dataclass
class ReferredClass:
    sub_class: SubClass

    def trigger_bug(self):
        SubClass(my_ref=self)

