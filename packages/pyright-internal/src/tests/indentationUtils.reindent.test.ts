/*
 * indentationUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for indentationUtils module.
 */

import assert from 'assert';

import { TextRange } from '../common/textRange';
import { reindentSpan } from '../languageService/indentationUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('re-indentation simple', () => {
    const code = `
//// [|/*marker*/def foo(): pass|]
    `;

    const expected = `def foo(): pass`;
    testIndentation(code, 0, expected);
});

test('re-indentation indent first token', () => {
    const code = `
//// [|/*marker*/   def foo(): pass|]
    `;

    const expected = `  def foo(): pass`;
    testIndentation(code, 2, expected);
});

test('re-indentation explicit multiline expression', () => {
    const code = `
//// [|/*marker*/def foo():
////     i = \\
////         1 \\
////           + \\
////         2|]
    `;

    const expected = `  def foo():
      i = \\
          1 \\
            + \\
          2`;

    testIndentation(code, 2, expected);
});

test('re-indentation explicit multiline expression with multiple backslash', () => {
    const code = `
//// [|/*marker*/def foo():
////     i = \\
////         \\
////         \\
////         1|]
    `;

    const expected = `  def foo():
      i = \\
          \\
          \\
          1`;

    testIndentation(code, 2, expected);
});

test('re-indentation multiline construct', () => {
    const code = `
//// [|/*marker*/def \\
////     foo():
////     i = 1 + 2|]
    `;

    const expected = `  def \\
      foo():
      i = 1 + 2`;

    testIndentation(code, 2, expected);
});

test('re-indentation implicit multiline expression', () => {
    const code = `
//// [|/*marker*/def foo():
////     i = (
////          1
////           +
////          2
////         )|]
    `;

    const expected = `  def foo():
      i = (
           1
            +
           2
          )`;

    testIndentation(code, 2, expected);
});

test('re-indentation implicit multiline expression with multiple blank lines', () => {
    const code = `
//// [|/*marker*/def foo():
////     i = [
////          1,
////
////          2
////         ]|]
    `;

    const expected = `  def foo():
      i = [
           1,

           2
          ]`;

    testIndentation(code, 2, expected);
});

test('re-indentation single line string', () => {
    const code = `
//// [|/*marker*/def foo():
////     str = "string data"|]
    `;

    const expected = `  def foo():
      str = "string data"`;

    testIndentation(code, 2, expected);
});

test('re-indentation multiline line string', () => {
    const code = `
//// [|/*marker*/def foo():
////     str = """first line
////         second line
////     last line
//// """|]
    `;

    const expected = `  def foo():
      str = """first line
        second line
    last line
"""`;

    testIndentation(code, 2, expected);
});

test('re-indentation with comments', () => {
    const code = `
//// [|/*marker*/def foo(): # comment at the end
////     # commend above the line
////     a = ( # commend at multiline expression
////           1 + 2 # comment after expression
////         )
////     # commend before end of file|]
    `;

    const expected = `  def foo(): # comment at the end
      # commend above the line
      a = ( # commend at multiline expression
            1 + 2 # comment after expression
          )
      # commend before end of file`;

    testIndentation(code, 2, expected);
});

test('re-indentation with comments with backslash', () => {
    const code = `
//// [|/*marker*/def foo(): # comment at the end
////     # commend above the line
////     a = \\
////         1 + 2 # comment after expression
//// 
////     # commend before end of file|]
    `;

    const expected = `  def foo(): # comment at the end
      # commend above the line
      a = \\
          1 + 2 # comment after expression

      # commend before end of file`;

    testIndentation(code, 2, expected);
});

test('re-indentation doc comment', () => {
    const code = `
//// [|/*marker*/def foo():
////     """ doc comment """
////     a = 1|]
    `;

    const expected = `  def foo():
      """ doc comment """
      a = 1`;

    testIndentation(code, 2, expected);
});

test('re-indentation multiline doc comment', () => {
    const code = `
//// [|/*marker*/def foo():
////     """ doc comment 
////         line 1
////         line 2
////     """
////     a = 1|]
    `;

    const expected = `  def foo():
      """ doc comment 
          line 1
          line 2
      """
      a = 1`;

    testIndentation(code, 2, expected);
});

test('re-indentation top level multiline doc comment', () => {
    const code = `
//// [|/*marker*/    """ doc comment
////         line 1
////         line 2
////     """
////  a = 1|]
    `;

    const expected = `  """ doc comment
      line 1
      line 2
  """
a = 1`;

    testIndentation(code, 2, expected);
});

test('re-indentation invalid code', () => {
    const code = `
//// [|/*marker*/ASDF
//// ASDFASDFASD
//// 
//// asdf asdf asd fasdf sdf asdf asdf asdf
////  23234235
////    $%^#&*()_++
//// asdfas asdf|]
    `;

    const expected = `  ASDF
  ASDFASDFASD

  asdf asdf asd fasdf sdf asdf asdf asdf
   23234235
     $%^#&*()_++
  asdfas asdf`;

    testIndentation(code, 2, expected);
});

test('re-indentation without first token', () => {
    const code = `
//// """ doc string """
//// i = [|/*marker*/(
////         1 + 2
////     )|]
    `;

    const expected = `(
    1 + 2
)`;

    testIndentation(code, 0, expected, /*indentFirstToken*/ false);
});

test('re-indentation single line variable doc string', () => {
    const code = `
//// [|/*marker*/i = 1
//// """ doc string """|]
    `;

    const expected = `  i = 1
  """ doc string """`;

    testIndentation(code, 2, expected);
});

test('re-indentation multiple line variable doc string', () => {
    const code = `
//// [|/*marker*/i = 1
//// """ doc string
////     line 1
//// """|]
    `;

    const expected = `  i = 1
  """ doc string
      line 1
  """`;

    testIndentation(code, 2, expected);
});

test('re-indentation single token', () => {
    const code = `
//// [|/*marker*/a|]
    `;

    const expected = `  a`;

    testIndentation(code, 2, expected);
});

test('re-indentation between statements', () => {
    const code = `
//// def foo():
////     pass
//// [|/*marker*/i = 1|]
//// """ doc string
////     line 1
//// """
    `;

    const expected = `  i = 1`;

    testIndentation(code, 2, expected);
});

test('re-indentation inside of body', () => {
    const code = `
//// def foo():
//// [|/*marker*/    """ doc string
////         line 1
////     """
////     i = 10|]
    `;

    const expected = `  """ doc string
      line 1
  """
  i = 10`;

    testIndentation(code, 2, expected);
});

test('re-indentation tab', () => {
    const code = `
//// def foo():
//// [|/*marker*/\t""" doc string
//// \t\tline 1
//// \t"""
//// \ti = 10|]
    `;

    const expected = `  """ doc string
\t  line 1
  """
  i = 10`;

    testIndentation(code, 2, expected);
});

test('re-indentation tab on multiline text', () => {
    const code = `
//// def foo():
//// [|/*marker*/\ta = """ line 1
//// \t\tline 2
//// \t"""
//// \ti = 10
//// \tif True:
//// \t\tpass|]
    `;

    const expected = `  a = """ line 1
\t\tline 2
\t"""
  i = 10
  if True:
\t  pass`;

    testIndentation(code, 2, expected);
});

function testIndentation(code: string, indentation: number, expected: string, indentFirstToken = true) {
    const state = parseAndGetTestState(code).state;
    const range = state.getRangeByMarkerName('marker')!;

    const parseResults = state.program.getBoundSourceFile(range.fileName)!.getParseResults()!;
    const actual = reindentSpan(
        parseResults,
        TextRange.fromBounds(range.pos, range.end),
        indentation,
        indentFirstToken
    );

    assert.strictEqual(actual, expected);
}
