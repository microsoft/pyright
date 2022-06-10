# This sample tests the reportTypeCommentUsage diagnostic check.

# This should generate an error if reportTypeCommentUsage is enabled.
x = 3  # type: int


class Foo:
    # This should generate an error if reportTypeCommentUsage is enabled.
    y = 0  # type: int

    def __init__(self):
        # This should generate an error if reportTypeCommentUsage is enabled.
        self.x = 2  # type: int
