# This tests various f-string parsing and analysis cases.

# Test nested f-strings.
a = f'hello { f"hi {1}" } bye { f"hello" }'


# Test f-string with a backslash in the expression.
# This should generate an error.
b = f"hello { \t1 }"


# Test f-string with unterminated expression.
# This should generate an error.
c = f"hello { 1 "


# Test f-string with double braces.
d = f"hello {{{1}}}"

# Test f-string with formatting directives.
e = f"hello { 2 != 3 !r:2 }"

# Test f-string with formatting directives.
f = f"hello { 2 != 3 :3 }"

# Test f-string with embedded colon.
g = f"hello { a[2:3] :3 }"

# Test f-string with embedded bang.
h = f"hello { b['hello!'] :3 }"

# Test f-string with expression that contains newlines.
i = f"""
    {
        f''' hi ''' +
        'bye'
    }
"""

j = f"""
{
    f'''
        {f' { f":" } '}
    '''
}
"""

# This should generate a warning because of the unknown
# escape sequence but not an error.
h = f"hello\{4}"

# Test f-string with raw string and backslash.
j = rf"aaa\{4}"

# Test f-string with comma-separated expressions.
h = f"List: { 2 + 3, 'hi' + ' there'}"
