from typing import Sequence
#                  ^^^^^^^^ reference  snapshot-util 0.1 typing/Sequence#

class PropertyClass:
#     ^^^^^^^^^^^^^ definition  snapshot-util 0.1 property_access/PropertyClass#
    def __init__(self):
#       ^^^^^^^^ definition  snapshot-util 0.1 property_access/PropertyClass#__init__().
#                ^^^^ definition  snapshot-util 0.1 property_access/PropertyClass#__init__().(self)
        pass

    @property
#    ^^^^^^^^ reference  python-stdlib 3.10 builtins/property#
    def prop_ref(self):
#       ^^^^^^^^ definition  snapshot-util 0.1 property_access/PropertyClass#prop_ref().
#                ^^^^ definition  snapshot-util 0.1 property_access/PropertyClass#prop_ref().(self)
        return 5


xs = [PropertyClass()]
#^ definition  snapshot-util 0.1 property_access/xs.
#     ^^^^^^^^^^^^^ reference  snapshot-util 0.1 property_access/PropertyClass#

def usage(xs: Sequence[PropertyClass]):
#   ^^^^^ definition  snapshot-util 0.1 property_access/usage().
#         ^^ definition  snapshot-util 0.1 property_access/usage().(xs)
#             ^^^^^^^^ reference  snapshot-util 0.1 typing/Sequence#
#                      ^^^^^^^^^^^^^ reference  snapshot-util 0.1 property_access/PropertyClass#
    def nested():
#       ^^^^^^ definition  snapshot-util 0.1 property_access/usage().nested().
        for x in xs:
#           ^ definition local 0
#                ^^ reference  snapshot-util 0.1 property_access/usage().(xs)
            print(x.prop_ref)
#           ^^^^^ reference  python-stdlib 3.10 builtins/print().
#                 ^ reference local 0
#                   ^^^^^^^^ reference  snapshot-util 0.1 property_access/PropertyClass#prop_ref().

