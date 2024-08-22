/// <reference path="typings/fourslash.d.ts" />

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
//// [|/*marker10*/doubleQuotesWithEscapedQuote|]= "\""
//// [|/*marker11*/tripleQuotesWithEscapedQuote|]= '''\n\'\'\''''
//// [|/*marker12*/tripleDoubleQuotesWithEscapedQuote|]= """\n\"\"\""""

//// # mixing quotes
//// [|/*marker13*/singleQuotesWithDouble|]= '"'
//// [|/*marker14*/singleQuotesWithTripleDouble|]= '"""'
//// [|/*marker15*/singleTripleQuoteWithSingleAndDoubleQuote|]= ''' '"' '''

//// # multiline (truncated)
//// const [|/*marker16*/html|] = '''<!DOCTYPE html><html lang="en">\n<head><title>Title</title></head></html>'''
//// const [|/*marker17*/htmlWithSingleQuotes|] = '''<!DOCTYPE html><html lang="en">\n<head><title>Title's</title></head></html>'''
//// const [|/*marker18*/htmlWithTripleEscapedQuotes|] = '''<!DOCTYPE html><html lang="en">\n<head><title>Title\'\'\'s</title></head></html>'''

helper.verifyHover('markdown', {
    marker1: `\`\`\`python\n(variable) emptySingleQuotes: Literal['']\n\`\`\``,
    marker2: `\`\`\`python\n(variable) emptyDoubleQuotes: Literal['']\n\`\`\``,
    marker3: `\`\`\`python\n(variable) emptyTripleQuotes: Literal['']\n\`\`\``,
    marker4: `\`\`\`python\n(variable) emptyTripleDoubleQuotes: Literal['']\n\`\`\``,
    marker5: `\`\`\`python\n(variable) simpleSingleQuotes: Literal['a']\n\`\`\``,
    marker6: `\`\`\`python\n(variable) simpleDoubleQuotes: Literal['b']\n\`\`\``,
    marker7: `\`\`\`python\n(variable) simpleTripleQuotes: Literal['foo\\nbar']\n\`\`\``,
    marker8: `\`\`\`python\n(variable) simpleTripleDoubleQuotes: Literal['foo\\nbar']\n\`\`\``,
    marker9: `\`\`\`python\n(variable) singleQuotesWithEscapedQuote: Literal['\\\'']\n\`\`\``,
    marker10: `\`\`\`python\n(variable) doubleQuotesWithEscapedQuote: Literal['"']\n\`\`\``,
    marker11: `\`\`\`python\n(variable) tripleQuotesWithEscapedQuote: Literal['\\n\\'\\'\\'']\n\`\`\``,
    marker12: `\`\`\`python\n(variable) tripleDoubleQuotesWithEscapedQuote: Literal['\\n"""']\n\`\`\``,
    marker13: `\`\`\`python\n(variable) singleQuotesWithDouble: Literal['"']\n\`\`\``,
    marker14: `\`\`\`python\n(variable) singleQuotesWithTripleDouble: Literal['"""']\n\`\`\``,
    marker15: `\`\`\`python\n(variable) singleTripleQuoteWithSingleAndDoubleQuote: Literal[' \\'"\\' ']\n\`\`\``,
    marker16: `\`\`\`python\n(variable) html: Literal['<!DOCTYPE html><html lang="en">\\n<head><title>Title…']\n\`\`\``,
    marker17: `\`\`\`python\n(variable) htmlWithSingleQuotes: Literal['<!DOCTYPE html><html lang="en">\\n<head><title>Title…']\n\`\`\``,
    marker18: `\`\`\`python\n(variable) htmlWithTripleEscapedQuotes: Literal['<!DOCTYPE html><html lang="en">\\n<head><title>Title…']\n\`\`\``,
});
