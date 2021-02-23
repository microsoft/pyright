# This sample tests the type checker's handling of
# member assignments.


class Foo:
    def __init__(self):
        self.string_list: list[str] = []

    def do_something(self, num: int) -> str:
        return ""


a = Foo()

a.string_list = ["yep"]

# This should generate an error because of a type mismatch.
a.string_list = "bbb"

# This should generate an error because of a type mismatch.
a.string_list = {}

# This should generate an error because of a type mismatch.
a.string_list = [1]

# This should generate an error because there is no member
# called string_list2 defined.
a.string_list2 = 4


def patch1(num: int) -> str:
    return ""


def patch2(self, num: int) -> str:
    return ""


a.do_something = lambda num: "hello"
a.do_something = patch1

# This should generate an error because of a param count mismatch
a.do_something = lambda: "hello"

# This should generate an error because of a return type mismatch
a.do_something = lambda x: 1


Foo.do_something = patch2

# This should generate an error because of a param count mismatch
Foo.do_something = patch1


class Class1:
    # This should generate an error because assignment expressions
    # can't be used within a class.
    [(j := i) for i in range(5)]
