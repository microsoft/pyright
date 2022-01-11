class ExampleClass:
#     ^^^^^^^^^^^^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#
    a: int
#   ^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#a.
#      ^^^ reference lsif-pyright pypi python 3.9 int.
    b: int
#   ^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#b.
#      ^^^ reference lsif-pyright pypi python 3.9 int.
    c: str
#   ^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#c.
#      ^^^ reference lsif-pyright pypi python 3.9 str.

    static_var = "Hello World"
#   ^^^^^^^^^^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#static_var.

    def __init__(self, a: int, b: int):
#       ^^^^^^^^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().
#                ^^^^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().(self)
#                      ^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().(a)
#                         ^^^ reference lsif-pyright pypi python 3.9 int.
#                              ^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().(b)
#                                 ^^^ reference lsif-pyright pypi python 3.9 int.
        local_c = ", world!"
#       ^^^^^^^ definition lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().local_c.

        self.a = a
#       ^^^^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().(self)
#            ^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#a.
#                ^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().(a)
        self.b = b
#       ^^^^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().(self)
#            ^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#b.
#                ^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().(b)
        self.c = "hello" + local_c
#       ^^^^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().(self)
#            ^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#c.
#                          ^^^^^^^ reference lsif-pyright pypi src.single_class 0.0 ExampleClass#__init__().local_c.

