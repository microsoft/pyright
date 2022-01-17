# This sample tests the type checker's handling of
# augmented assignments (combining a binary operator
# with an assignment).


a = 1
b = 3.4

a += b
reveal_type(a, expected_text="float")

a -= b
reveal_type(a, expected_text="float")

a *= b
reveal_type(a, expected_text="float")

a /= b
reveal_type(a, expected_text="float")

a //= b
reveal_type(a, expected_text="float")

a %= b
reveal_type(a, expected_text="float")

a **= b
reveal_type(a, expected_text="Any")

a = 1

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


# Test __iadd__ override in list class, which accepts
# any iterator as an argument.
bar = ("d",)
foo = ["a", "b"]
foo += ["c"]
foo += bar
