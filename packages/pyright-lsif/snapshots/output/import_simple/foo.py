def exported_function():
#   ^^^^^^^^^^^^^^^^^ reference  foo 0.1 exported_function().
    return "function"

class MyClass:
#     ^^^^^^^ reference  foo 0.1 MyClass#
    def __init__(self):
#       ^^^^^^^^ reference  foo 0.1 MyClass#__init__().
#                ^^^^ reference  foo 0.1 MyClass#__init__().(self)
        pass

    def exported_function(self):
#       ^^^^^^^^^^^^^^^^^ reference  foo 0.1 MyClass#exported_function().
#                         ^^^^ reference  foo 0.1 MyClass#exported_function().(self)
        return "exported"

this_class = MyClass()
#^^^^^^^^^ definition  foo 0.1 this_class.
#            ^^^^^^^ reference  foo 0.1 MyClass#

