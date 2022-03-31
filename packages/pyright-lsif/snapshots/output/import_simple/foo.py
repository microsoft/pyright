def exported_function():
#   ^^^^^^^^^^^^^^^^^ definition  foo test exported_function().
    return "function"

class MyClass:
#     ^^^^^^^ definition  foo test MyClass#
    def __init__(self):
#       ^^^^^^^^ definition  foo test MyClass#__init__().
#                ^^^^ definition  foo test MyClass#__init__().(self)
        pass

    def exported_function(self):
#       ^^^^^^^^^^^^^^^^^ definition  foo test MyClass#exported_function().
#                         ^^^^ definition  foo test MyClass#exported_function().(self)
        return "exported"

this_class = MyClass()
#^^^^^^^^^ reference  foo test this_class.
#            ^^^^^^^ reference  foo test MyClass#

