def exported_function():
#   ^^^^^^^^^^^^^^^^^ definition lsif-pyright pypi foo 0.0 exported_function().
    return "function"

class MyClass:
#     ^^^^^^^ definition lsif-pyright pypi foo 0.0 MyClass#
    def __init__(self):
#       ^^^^^^^^ definition lsif-pyright pypi foo 0.0 MyClass#__init__().
#                ^^^^ definition lsif-pyright pypi foo 0.0 MyClass#__init__().(self)
        pass

    def exported_function(self):
#       ^^^^^^^^^^^^^^^^^ definition lsif-pyright pypi foo 0.0 MyClass#exported_function().
#                         ^^^^ definition lsif-pyright pypi foo 0.0 MyClass#exported_function().(self)
        return "exported"

this_class = MyClass()
#^^^^^^^^^ definition this_class.
#            ^^^^^^^ reference lsif-pyright pypi foo 0.0 MyClass#

