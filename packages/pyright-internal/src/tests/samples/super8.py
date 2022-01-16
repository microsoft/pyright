# This sample tests the case where super() is used within a metaclass
# __init__ method.


class Metaclass(type):
    def __init__(self, name, bases, attrs):
        super().__init__(name, bases, attrs)
