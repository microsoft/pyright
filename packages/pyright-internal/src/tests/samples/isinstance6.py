# This sample tests isinstance and issubclass type narrowing
# based on cls and self parameters.


class Foo:
    @classmethod
    def bar(cls, other: type):
        if issubclass(other, cls):
            reveal_type(other, expected_text="Type[Self@Foo]")

        if issubclass(other, (int, cls)):
            reveal_type(other, expected_text="Type[Self@Foo] | Type[int]")

    def baz(self, other: object):
        if isinstance(other, self.__class__):
            reveal_type(other, expected_text="Self@Foo")

        if isinstance(other, (int, self.__class__)):
            reveal_type(other, expected_text="Self@Foo | int")
