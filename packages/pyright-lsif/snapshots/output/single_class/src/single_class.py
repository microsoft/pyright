class ExampleClass:
#     ^^^^^^^^^^^^ definition  src/single_class 0.1 ExampleClass#
    a: int
#   ^ definition  src/single_class 0.1 ExampleClass#a.
    b: int
#   ^ definition  src/single_class 0.1 ExampleClass#b.
    c: str
#   ^ definition  src/single_class 0.1 ExampleClass#c.

    static_var = "Hello World"
#   ^^^^^^^^^^ definition  src/single_class 0.1 ExampleClass#static_var.

    def __init__(self, a: int, b: int):
#       ^^^^^^^^ definition  src/single_class 0.1 ExampleClass#__init__().
#                ^^^^ definition  src/single_class 0.1 ExampleClass#__init__().(self)
#                      ^ definition  src/single_class 0.1 ExampleClass#__init__().(a)
#                              ^ definition  src/single_class 0.1 ExampleClass#__init__().(b)
        local_c = ", world!"
#       ^^^^^^^ definition  src/single_class 0.1 ExampleClass#__init__().local_c.

        self.a = a
#       ^^^^ reference  src/single_class 0.1 ExampleClass#__init__().(self)
#            ^ reference  src/single_class 0.1 ExampleClass#a.
#                ^ reference  src/single_class 0.1 ExampleClass#__init__().(a)
        self.b = b
#       ^^^^ reference  src/single_class 0.1 ExampleClass#__init__().(self)
#            ^ reference  src/single_class 0.1 ExampleClass#b.
#                ^ reference  src/single_class 0.1 ExampleClass#__init__().(b)
        self.c = "hello" + local_c
#       ^^^^ reference  src/single_class 0.1 ExampleClass#__init__().(self)
#            ^ reference  src/single_class 0.1 ExampleClass#c.
#                          ^^^^^^^ reference  src/single_class 0.1 ExampleClass#__init__().local_c.

