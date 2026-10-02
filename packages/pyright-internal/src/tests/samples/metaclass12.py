# This sample tests that class instances with a custom metaclass
# do not inherit members from the metaclass (such as type.__dict__).

from typing import Any


class Meta(type):
    def meta_method(self) -> str:
        return "meta"


class A(metaclass=Meta):
    pass


def func(a: A):
    # This should resolve to dict[str, Any] from object, not MappingProxyType[str, Any] from type.
    reveal_type(a.__dict__, expected_text="dict[str, Any]")

    # This should generate an error because meta_method is on the metaclass,
    # not the instance.
    a.meta_method()


# Access through the class itself should resolve via the metaclass.
reveal_type(A.__dict__, expected_text="MappingProxyType[str, Any]")
reveal_type(A.meta_method(), expected_text="str")


class Fields:
    def initialize(self) -> None:
        self.label: str = "ok"


class Meta2(type, Fields):
    def __init__(cls, name: str, bases: tuple[type, ...], ns: dict[str, Any]) -> None:
        cls.initialize()


class C(metaclass=Meta2):
    pass


# Instance variables declared in a base class of the metaclass
# should remain accessible through the class and its instances.
reveal_type(C.label, expected_text="str")
reveal_type(C().label, expected_text="str")
