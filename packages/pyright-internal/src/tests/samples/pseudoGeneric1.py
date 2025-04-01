# This sample tests type checking scenarios related to "pseudo generic"
# classes - those whose constructors are unannotated.

_DEFAULT_VALUE = object()


class ClassA:
    def __init__(self, name, description=_DEFAULT_VALUE): ...

    @classmethod
    def create_new(cls):
        return cls("", None)


a1: list[ClassA] = [ClassA("a", description="b")]
a2: list[ClassA] = [ClassA("c")]
a3: list[ClassA] = a1 + a2


class ClassB:
    def __init__(self, a, b, c=None, d=""):
        self.a = a
        self.b = b
        self.c = c
        self.d = d


b1 = ClassB(1, "")
reveal_type(b1.a, expected_text="int")
reveal_type(b1.b, expected_text="str")
reveal_type(b1.c, expected_text="Unknown | None")
reveal_type(b1.d, expected_text="str")

b2 = ClassB("", 1.2, 2, "")
reveal_type(b2.a, expected_text="str")
reveal_type(b2.b, expected_text="float")
reveal_type(b2.c, expected_text="Unknown | None")
reveal_type(b2.d, expected_text="str")
