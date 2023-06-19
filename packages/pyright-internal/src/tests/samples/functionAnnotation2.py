# This sample tests support for comment-style function annotations.


# Too few annotations
def func1a(a, b):
    # type: (str) -> str
    return ""


# Too many annotations
def func1b(a, b):  # type: (str, int, int) -> str
    return ""


class ClassA:
    def method0(self, a, b):
        # type: (str, int) -> str
        return ""

    # Too few annotations
    def method1(self, a, b):
        # type: (str) -> str
        return ""

    # Too many annotations
    def method2(self, a, b):  # type: (str, int, int, int) -> str
        return ""
