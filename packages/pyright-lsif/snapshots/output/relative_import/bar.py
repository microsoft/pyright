from .foo import exported_function
#                ^^^^^^^^^^^^^^^^^ reference  foo unknown exported_function().
from .foo import this_class
#                ^^^^^^^^^^ reference  foo unknown this_class#

if True:
    exported_function()
#   ^^^^^^^^^^^^^^^^^ reference  foo unknown exported_function().

    this_class.exported_function()
#   ^^^^^^^^^^ reference  foo unknown this_class#
#              ^^^^^^^^^^^^^^^^^ reference  foo unknown MyClass#exported_function().

