from .foo import exported_function
#                ^^^^^^^^^^^^^^^^^ reference  foo test exported_function().
from .foo import this_class
#                ^^^^^^^^^^ reference  foo test this_class#

if True:
    exported_function()
#   ^^^^^^^^^^^^^^^^^ reference  foo test exported_function().

    this_class.exported_function()
#   ^^^^^^^^^^ reference  foo test this_class#
#              ^^^^^^^^^^^^^^^^^ reference  foo test MyClass#exported_function().

