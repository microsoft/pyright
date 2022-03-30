def exported_function():
#   ^^^^^^^^^^^^^^^^^ reference  foo test exported_function().
    return "function"

class MyClass:
#     ^^^^^^^ reference  foo test MyClass#
    def __init__(self):
#       ^^^^^^^^ reference  foo test MyClass#__init__().
#                ^^^^ reference  foo test MyClass#__init__().(self)
        pass

    def exported_function(self):
#       ^^^^^^^^^^^^^^^^^ reference  foo test MyClass#exported_function().
#                         ^^^^ reference  foo test MyClass#exported_function().(self)
        return "exported"

this_class = MyClass()
#^^^^^^^^^ definition  foo test this_class.
#            ^^^^^^^ reference  foo test MyClass#

