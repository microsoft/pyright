# This sample tests the use of "self.__class__" and "__class__"
# in an isinstance call.


class Foo:
    def bar(self):
        a = isinstance(object(), self.__class__)
        b = isinstance(object(), __class__)
