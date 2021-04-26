# This sample tests that the tokenizer properly handles
# line feeds.

"""
This is a multi-line comment \
with escape characters.
"""

# This is a raw string with an escaped EOL.
foo = r"\
"

# The final token should be on line 14
bar = foo
