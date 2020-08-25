# This sample tests the type checker's ability to
# handle various class definition cases.


class Foo:
    pass

class Bar(Foo):
    pass

class Bar2(Foo, metaclass=type):
    def my_method(self):
        print(__class__)

# This should generate an error because only one metaclass is supported.
class Bar3(Foo, metaclass=type, metaclass=type):
    pass

class Bar4(Foo, other_keyword=2):
    pass



 