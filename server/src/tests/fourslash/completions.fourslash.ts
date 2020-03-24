/// <reference path="fourslash.ts" />

// @filename: test.py
////import time
////time.lo/*marker1*/
////aaaaaa = 100
////aaaa/*marker2*/
////def some_function(a):
////    print(a)
////some_fun/*marker3*/

helper.verifyCompletion('test.py', {
    marker1: { completionResults: ['localtime'] },
    marker2: { completionResults: ['aaaaaa'] },
    marker3: { completionResults: ['some_function'] }
});
