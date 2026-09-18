# This sample tests basic template string type functionality.


# This should result in an error because x is not defined.
t1 = t"Hello {x=}"

age = 30
t2 = t'''Age = {age}'''
reveal_type(t2, expected_text="Template")

t3 = Tr""
reveal_type(t3, expected_text="Template")

# Implicit concatenation of t-string literals is allowed.
t4 = t"Hello " t"{age}"
reveal_type(t4, expected_text="Template")

t4.strings
t4.interpolations
t4.values

# This should generate an error because t-string literals cannot be
# mixed with string literals.
t5 = "" t"x"

# This should generate an error.
t6 = t"x" "y"

# This should generate an error.
t7 = t"x" f"y"

# This should generate an error.
t8 = t"x" b"y"

t9 = t"a" + t"b"
reveal_type(t9, expected_text="Template")

# This should generate an error because Template and str cannot be added.
t10 = t"a" + "b"
