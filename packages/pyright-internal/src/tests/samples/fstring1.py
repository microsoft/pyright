# This tests various f-string parsing and analysis cases.

# Test nested f-strings.
a = f'hello { f"hi {1}" } bye { f"hello" }'


# Test f-string with a backslash in the expression.
# This should generate an error.
b = f"hello { \t1 }"

# This should generate an error prior to Python 3.12.
b1 = f"""{"\n"}"""

# This should generate an error prior to Python 3.12.
b2 = f"{r'\n'}"


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
h = f"hello { {}['hello!'] :3 }"

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

# Test f-string with raw string and backslash.
j = rf"aaa\{4}"

# Test f-string with comma-separated expressions.
h = f"List: { 2 + 3, 'hi' + ' there'}"

# Test f-string with unpack operator.
my_dict = {"a": "A", "b": "B"}
i = f"{*my_dict.keys(),}"

# f-string with empty expression should generate error.
j = f"{}"

# f-string with quotes within quotes within quotes.
k = f"""{"#M's#".replace(f"'", '')!r}"""


# f-strings with escape characters in the format string section.
my_str = ""
width = 3
l = f"{my_str:\>{width}s}"
m = f"{my_str:\x00>{width}s}"
n = f"{my_str:\u2007>{width}s}"

# f-strings with nested expressions in the format string section.
o = f"{1+2:{1+2:{1+1:}}}"

# This should generate an error because the nesting is too deep.
p = f"{1+2:{1+2:{1+1:{1}}}}"

# This should generate a warning because of the unknown
# escape sequence but not an error.
q = f"hello\{4}"

s1 = f"""{f'''{f'{f"{1+1}"}'}'''}"""

# This should generate an error prior to Python 3.12.
s2 = f"""{f'''{f'{f"""{1+1}"""}'}'''}"""

# This should generate an error prior to Python 3.12.
s3 = f'{f'''{r'abc'}'''}'

q1 = f"""{
    1 + 1   # Comment
    }"""

# This should generate an error prior to Python 3.12, but
# pyright doesn't currently detect this error.
q2 = f'{
    1 + 1   # Comment
    }'

# This should generate an error because an expression is missing.
r1 = f'{!r}'

# This should generate an error because an expression is missing.
r2 = f'{!}'

# This should generate an error because an expression is missing.
r3 = f'{:}'

# This should generate an error because an expression is missing.
r4 = f'{=}'

r5 = f'{1!s:}'
r6 = f'{1:}'
r7 = f'{1=}'
r8 = f'{1=:}'
r9 = f'{1=!r:}'

s1 = f"}}"

# This should generate an error because a single right brace is used.
s2 = f"}"

t1 = f'{0==1}'
t2 = f'{0!=1}'
t3 = f'{0<=1}'

# This should generate an error because this isn't a walrus
# operator as it appears.
t4 = f'{x1:=3}'

t5 = f"{(x2:=3):{(x3:=0)}}"

u1 = f"'{{\"{0}\": {0}}}'"

def func1(x):
    f"x:{yield (lambda i: x * i)}"

v1 = f"x \
y"

v2 = f'x \
y'

w1 = 1

w2 = f"__{
    w1:d
}__"


# This should generate an error because it's unterminated.
w3 = f"test

