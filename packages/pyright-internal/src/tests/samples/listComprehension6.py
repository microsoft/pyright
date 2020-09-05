# This sample tests parsing of list comprehensions with
# various syntax errors.

# This should generate an error.
(*i for i in [])

# This should generate an error.
[*i for i in []]

# This should generate an error.
{*d for d in []}

# This should generate an error.
{**d for d in []}
