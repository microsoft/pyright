# This sample tests the tokenizer's ability to detect inconsistent
# use of tab and spaces in a way that's ambiguous.

def main(jsonIn):
    print("a")
	# This should generate an error because of inconsistent use of
	# tabs and spaces.
	print("b")

