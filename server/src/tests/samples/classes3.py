# This sample tests that various class variables (as defined in
# the type metaclass) are accessible without a type error.


class TestClass:
    pass


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
