# This sample handles the case where a class doesn't define its own
# constructor and relies on the `object` class constructor, which accepts
# no parameters.


class A:
    pass


a1 = A()

# This should generate an error
a2 = A(1)

a3 = A(*[], **{})
