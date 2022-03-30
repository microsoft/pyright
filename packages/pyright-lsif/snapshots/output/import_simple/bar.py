from .foo import exported_function
#                ^^^^^^^^^^^^^^^^^ reference  foo 0.1 exported_function().
from .foo import this_class
#                ^^^^^^^^^^ reference  foo 0.1 this_class#

if True:
    exported_function()
#   ^^^^^^^^^^^^^^^^^ reference  foo 0.1 exported_function().

    this_class.exported_function()
#   ^^^^^^^^^^ reference  foo 0.1 this_class#
#              ^^^^^^^^^^^^^^^^^ reference  foo 0.1 MyClass#exported_function().

