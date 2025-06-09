# This sample tests error handling for template strings.


# This should generate an error if using Python 3.13 or earlier.
t1 = t'Hello {"World"}'

t2 = tr"""Test"""
t3 = rt"Test\n"


# This should generate two errors because tf is not a valid string type.
t4 = tf"{1}"

# This should generate two errors because ft is not a valid string type.
t5 = ft"{1}"

# This should generate two errors because tu is not a valid string type.
t6 = tu"{1}"

# This should generate two errors because ut is not a valid string type.
t7 = ut"{1}"

