# This sample tests the type checker's handling of
# augmented assignments (combining a binary operator
# with an assignment).

a = 1
b = 3.4

a += b
a -= b
a *= b
a /= b
a //= b
a %= b
a **= b

# This should generate an error because
# matrix multiply isn't supported by int.
a @= b

a |= b
a &= b
a ^= b
a <<= b
a >>= b


list1 = [1, 2, 3]
list1 += [4]

# This should generate an error
list1 += 4

# This should generate an error
list2 = [1]
list2 *= 4

# This should generate an error
list2 *= [4]


