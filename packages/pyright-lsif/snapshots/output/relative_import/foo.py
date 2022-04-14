def exported_function():
#   ^^^^^^^^^^^^^^^^^ definition  snapshot-util 0.1 foo/exported_function().
    return "function"

class MyClass:
#     ^^^^^^^ definition  snapshot-util 0.1 foo/MyClass#
    def __init__(self):
#       ^^^^^^^^ definition  snapshot-util 0.1 foo/MyClass#__init__().
#                ^^^^ definition  snapshot-util 0.1 foo/MyClass#__init__().(self)
        pass

    def exported_function(self):
#       ^^^^^^^^^^^^^^^^^ definition  snapshot-util 0.1 foo/MyClass#exported_function().
#                         ^^^^ definition  snapshot-util 0.1 foo/MyClass#exported_function().(self)
        return "exported"

this_class = MyClass()
#^^^^^^^^^ definition  snapshot-util 0.1 foo/this_class.
#            ^^^^^^^ reference  snapshot-util 0.1 foo/MyClass#

