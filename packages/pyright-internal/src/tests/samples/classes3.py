# This sample tests that various class variables (as defined in
# the type metaclass) are accessible without a type error.


from typing import TypeVar


class TestClass:
    # These should be accessible within the class body
    print(__doc__)
    print(__module__)
    print(__name__)
    print(__qualname__)


base = TestClass.__base__
basic_size = TestClass.__basicsize__
dict = TestClass.__dict__
dict_offset = TestClass.__dictoffset__
flags = TestClass.__flags__
item_size = TestClass.__itemsize__
module = TestClass.__module__
mro = TestClass.__mro__
name = TestClass.__name__
qualname = TestClass.__qualname__
reveal_type(qualname, expected_text="str")
text_signature = TestClass.__text_signature__
subclasses = TestClass.__subclasses__


# This should generate an error.
dummy = TestClass.__dummy__

instance = TestClass()

instance.__doc__
instance.__module__

# This should generate an error.
instance.__name__

# This should generate an error. Although the binder adds __qualname__ to a
# class's symbol table to make it available within a class body, __qualname__
# is exposed via the metaclass (type), not on instances, so instance access
# should be flagged.
instance.__qualname__


class Meta(type):
    def method1(self) -> str:
        return self.__name__


class NonMeta:
    def method1(self) -> str:
        # This should generate an error.
        return self.__name__


_T = TypeVar("_T")


def func1(cls: type[_T]) -> _T:
    x1 = cls.__dict__
    x2 = cls.__mro__

    # Access through a class object (here a `type[_T]`) is valid and resolves
    # via the metaclass `type`.
    x3 = cls.__qualname__
    reveal_type(x3, expected_text="str")

    return cls()


class Sub(TestClass):
    pass


sub_qualname = Sub.__qualname__
reveal_type(sub_qualname, expected_text="str")

sub_instance = Sub()

# This should generate an error. A base class's implicit __qualname__ must not
# be surfaced as an instance member through the MRO of a derived class.
sub_instance.__qualname__


class Outer:
    class Inner:
        # __qualname__ must remain name-resolvable inside nested class bodies.
        print(__qualname__)

    inner_qualname = Inner.__qualname__
    reveal_type(inner_qualname, expected_text="str")


inner_instance = Outer.Inner()

# This should generate an error.
inner_instance.__qualname__
