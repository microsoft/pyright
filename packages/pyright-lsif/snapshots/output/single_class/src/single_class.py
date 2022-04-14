class ExampleClass:
# definition  snapshot-util 0.1 `src.single_class`/__init__:
#     ^^^^^^^^^^^^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#
    a: int
#   ^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#a.
#      ^^^ reference  python-stdlib 3.10 builtins/int#
    b: int
#   ^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#b.
#      ^^^ reference  python-stdlib 3.10 builtins/int#
    c: str
#   ^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#c.
#      ^^^ reference  python-stdlib 3.10 builtins/str#

    static_var = "Hello World"
#   ^^^^^^^^^^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#static_var.

    def __init__(self, a: int, b: int):
#       ^^^^^^^^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().
#                ^^^^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().(self)
#                      ^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().(a)
#                         ^^^ reference  python-stdlib 3.10 builtins/int#
#                              ^ definition  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().(b)
#                                 ^^^ reference  python-stdlib 3.10 builtins/int#
        local_c = ", world!"
#       ^^^^^^^ definition local 0

        self.a = a
#       ^^^^ reference  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().(self)
#            ^ reference  snapshot-util 0.1 `src.single_class`/ExampleClass#a.
#                ^ reference  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().(a)
        self.b = b
#       ^^^^ reference  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().(self)
#            ^ reference  snapshot-util 0.1 `src.single_class`/ExampleClass#b.
#                ^ reference  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().(b)
        self.c = "hello" + local_c
#       ^^^^ reference  snapshot-util 0.1 `src.single_class`/ExampleClass#__init__().(self)
#            ^ reference  snapshot-util 0.1 `src.single_class`/ExampleClass#c.
#                          ^^^^^^^ reference local 0

