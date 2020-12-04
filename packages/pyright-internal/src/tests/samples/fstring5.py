# This sample tests the parsing and analysis of f-strings
# that end in an "=" sign. Support for this was added
# in Python 3.8.

key = 3

print(f"Value for {key =}")

print(f"Value for {key =    }")

print(f"Value for {key =   :.2f}")

print(f"Value for {key=}")

print(f"Value for {key=    }")

print(f"Value for {key=   :.2f}")
