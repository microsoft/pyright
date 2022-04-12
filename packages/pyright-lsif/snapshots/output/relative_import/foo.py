def exported_function():
#   ^^^^^^^^^^^^^^^^^ definition  foo unknown exported_function().
    return "function"

class MyClass:
#     ^^^^^^^ definition  foo unknown MyClass#
    def __init__(self):
#       ^^^^^^^^ definition  foo unknown MyClass#__init__().
#                ^^^^ definition  foo unknown MyClass#__init__().(self)
        pass

    def exported_function(self):
#       ^^^^^^^^^^^^^^^^^ definition  foo unknown MyClass#exported_function().
#                         ^^^^ definition  foo unknown MyClass#exported_function().(self)
        return "exported"

this_class = MyClass()
#^^^^^^^^^ definition  foo unknown this_class.
#            ^^^^^^^ reference  foo unknown MyClass#

