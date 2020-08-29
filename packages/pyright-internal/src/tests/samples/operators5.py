# This sample tests the parsing of the deprecated <> operator.

# This should generate a single error, not a cascade of errors.
if 3 <> 5:
    print("OK")
