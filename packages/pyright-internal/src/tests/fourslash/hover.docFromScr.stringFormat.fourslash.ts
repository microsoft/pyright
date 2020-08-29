/// <reference path="fourslash.ts" />

// @filename: test.py

//// # empty string
//// [|/*marker1*/emptySingleQuotes|]= ''
//// [|/*marker2*/emptyDoubleQuotes|]= ""
//// [|/*marker3*/emptyTripleQuotes|]= ''''''
//// [|/*marker4*/emptyTripleDoubleQuotes|]= """"""

//// # simple string
//// [|/*marker5*/simpleSingleQuotes|]= 'a'
//// [|/*marker6*/simpleDoubleQuotes|]= "b"
//// [|/*marker7*/simpleTripleQuotes|]= '''foo\nbar'''
//// [|/*marker8*/simpleTripleDoubleQuotes|]= """foo\nbar"""

//// # escaped quotes
//// [|/*marker9*/singleQuotesWithEscapedQuote|]= '\''
//// [|/*marker10*/doubleQuotesWithEscapedQuote|]= "\"""
//// [|/*marker11*/tripleQuotesWithEscapedQuote|]= '''\n\'\'\''''
//// [|/*marker12*/tripleDoubleQuotesWithEscapedQuote|]= """\n\"\"\"""""

//// # mixing quotes
//// [|/*marker13*/singleQuotesWithDouble|]= '"'
//// [|/*marker14*/singleQuotesWithTripleDouble|]= '"""'
//// [|/*marker15*/singleTripleQuoteWithSingleAndDoubleQuote|]= ''' '"' '''

//// # multiline
//// const [|/*marker16*/html|] = '''<!DOCTYPE html><html lang="en">\n<head><title>Title</title></head></html>'''
//// const [|/*marker17*/htmlWithSingleQuotes|] = '''<!DOCTYPE html><html lang="en">\n<head><title>Title's</title></head></html>'''
//// const [|/*marker18*/htmlWithTripleEscapedQuotes|] = '''<!DOCTYPE html><html lang="en">\n<head><title>Title\'\'\'s</title></head></html>'''

helper.verifyHover({
    marker1: { value: `\`\`\`python\n(variable) emptySingleQuotes: Literal['']\n\`\`\`\n`, kind: 'markdown' },
    marker2: { value: `\`\`\`python\n(variable) emptyDoubleQuotes: Literal['']\n\`\`\`\n`, kind: 'markdown' },
    marker3: { value: `\`\`\`python\n(variable) emptyTripleQuotes: Literal['']\n\`\`\`\n`, kind: 'markdown' },
    marker4: { value: `\`\`\`python\n(variable) emptyTripleDoubleQuotes: Literal['']\n\`\`\`\n`, kind: 'markdown' },
    marker5: { value: `\`\`\`python\n(variable) simpleSingleQuotes: Literal['a']\n\`\`\`\n`, kind: 'markdown' },
    marker6: { value: `\`\`\`python\n(variable) simpleDoubleQuotes: Literal['b']\n\`\`\`\n`, kind: 'markdown' },
    marker7: {
        value: `\`\`\`python\n(variable) simpleTripleQuotes: Literal['''foo\nbar''']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker8: {
        value: `\`\`\`python\n(variable) simpleTripleDoubleQuotes: Literal['''foo\nbar''']\n\`\`\`\n`,
        kind: 'markdown',
    },

    marker9: {
        value: `\`\`\`python\n(variable) singleQuotesWithEscapedQuote: Literal['\\'']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker10: {
        value: `\`\`\`python\n(variable) doubleQuotesWithEscapedQuote: Literal['\"']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker11: {
        value: `\`\`\`python\n(variable) tripleQuotesWithEscapedQuote: Literal['''\n\\'\\'\\'''']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker12: {
        value: `\`\`\`python\n(variable) tripleDoubleQuotesWithEscapedQuote: Literal['''\n\"\"\"''']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker13: { value: `\`\`\`python\n(variable) singleQuotesWithDouble: Literal['"']\n\`\`\`\n`, kind: 'markdown' },
    marker14: {
        value: `\`\`\`python\n(variable) singleQuotesWithTripleDouble: Literal['"""']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker15: {
        value: `\`\`\`python\n(variable) singleTripleQuoteWithSingleAndDoubleQuote: Literal[' \\'"\\' ']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker16: {
        value: `\`\`\`python\n(variable) html: Literal['''<!DOCTYPE html><html lang="en">\n<head><title>Title</title></head></html>''']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker17: {
        value: `\`\`\`python\n(variable) htmlWithSingleQuotes: Literal['''<!DOCTYPE html><html lang="en">\n<head><title>Title's</title></head></html>''']\n\`\`\`\n`,
        kind: 'markdown',
    },
    marker18: {
        value: `\`\`\`python\n(variable) htmlWithTripleEscapedQuotes: Literal['''<!DOCTYPE html><html lang="en">\n<head><title>Title\\'\\'\\'s</title></head></html>''']\n\`\`\`\n`,
        kind: 'markdown',
    },
});
