# This sample tests that assignment expressions used within the iterable
# expression of a comprehension "for" clause are reported with a message
# that specifically calls out the comprehension-iterable restriction from
# PEP 572. Unlike a bare assignment expression used as a comprehension
# "if" condition, this restriction cannot be resolved by adding parentheses.

x = []


# This should generate an error because an assignment expression is not
# allowed within a comprehension's iterable expression, even when it is
# surrounded by parentheses.
[a for a in (b := x)]

# This should generate an error because a bare (unparenthesized) assignment
# expression is not allowed as a comprehension "if" condition. Here, adding
# parentheses would make the code legal.
[a for a in x if c := a]
