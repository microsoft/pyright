# This sample tests nonlocal and global bindings
# with declared types.

foo: int = 23
baz: int = 23


def func():
    foo: str = "Hi"
    baz: str = "Hi"

    def func_1():
        global foo

        # This should generate an error because
        # the global "foo" is typed as a str.
        foo = "25"

        global bar

        bar: str = "Hi"

        nonlocal baz

        # This should generate an error because the
        # nonlocal "baz" is typed as str.
        baz = 25

    func_1()


func()

# This should generate an error because the
# type of "bar" is defined in func_1.
bar = 24
