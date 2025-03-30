# This sample tests the case where a custom metaclass has an attribute
# that holds a descriptor object and the attribute is accessed through
# a class constructed from the metaclass. The runtime has some surprising
# behavior in this case. It favors the metaclass descriptor object
# in this case even if the class has an instance attribute with the
# same name.


class MyMeta(type):
    @property
    def attr1(cls) -> int:
        return 1

    @property
    def attr3(cls) -> int:
        return 3

    attr4 = "4"

    @property
    def attr5(cls) -> int:
        return 5

    attr6 = 6

    def __getattr__(self, name: str) -> complex: ...


class A(metaclass=MyMeta):
    @property
    def attr2(self) -> int:
        return 2

    @property
    def attr3(self) -> int:
        return 3

    @property
    def attr4(self) -> int:
        return 4

    attr5 = "5"


reveal_type(A.attr1, expected_text="int")
reveal_type(A().attr2, expected_text="int")
reveal_type(A.attr2, expected_text="property")
reveal_type(A().attr3, expected_text="int")
reveal_type(A.attr3, expected_text="int")
reveal_type(A.attr4, expected_text="property")
reveal_type(A.attr5, expected_text="int")
reveal_type(A.attr6, expected_text="int")
reveal_type(A.attr7, expected_text="complex")
