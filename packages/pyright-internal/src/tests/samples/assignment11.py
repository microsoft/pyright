# This sample tests the type checker's handling of chained assignments.

a1 = b1 = c1 = d1 = 3

my_list = [10]
a2 = my_list[a2] = b2 = my_list[b2] = 0

# This should generate an error because a3 is read before written.
my_list[a3] = a3 = 0


# This should generate an error because type comments are not
# allowed for chained assignments.
x1 = x2 = x3 = [3]  # type: list[float]


# Bidirectional type inference should be used in this case.
y2: list[list[float]]
y1 = y2 = [[3]]
reveal_type(y1, expected_text="list[list[float]]")
