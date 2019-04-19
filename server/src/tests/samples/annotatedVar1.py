# This sample tests type annotations on variables.

array1 = [1, 2, 3]

# This should generate an error because the LHS can't
# have a declared type.
array1[2] = 4 # type: int

dict1 = {}

# This should generate an error because the LHS can't
# have a declared type.
dict1['hello'] = 4 # type: int

