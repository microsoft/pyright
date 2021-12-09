# This sample tests that various class variables (as defined in
# the type metaclass) are accessible without a type error.


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
text_signature = TestClass.__text_signature__
subclasses = TestClass.__subclasses__


# This should generate an error
dummy = TestClass.__dummy__

instance = TestClass()

instance.__doc__
instance.__module__

# These should generate an error because they are not visible to instances.
instance.__name__
instance.__qualname__


class Meta(type):
    def method1(self) -> str:
        return self.__name__


class NonMeta:
    def method1(self) -> str:
        # This should generate an error
        return self.__name__
