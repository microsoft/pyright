/// <reference path="typings/fourslash.d.ts" />

// @filename: declare.py
//// my_variable = "Hello, world!"

// @filename: consume.py
//// from my_module import my_variable as /*marker*/greeting
////
//// print(greeting)

{
    helper.verifyShowCallHierarchyGetIncomingCalls({
        marker: {
            items: [],
        },
    });
}
