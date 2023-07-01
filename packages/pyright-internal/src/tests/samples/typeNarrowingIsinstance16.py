# This sample tests isinstance and issubclass type narrowing
# based on cls and self parameters.


class ClassA:
    @classmethod
    def bar(cls, other: type):
        if issubclass(other, cls):
            reveal_type(other, expected_text="type[Self@ClassA]")

        if issubclass(other, (int, cls)):
            reveal_type(other, expected_text="type[Self@ClassA] | type[int]")

    def baz(self, other: object):
        if isinstance(other, type(self)):
            reveal_type(other, expected_text="Self@ClassA")

        if isinstance(other, (int, type(self))):
            reveal_type(other, expected_text="Self@ClassA | int")
