/// <reference path="typings/fourslash.d.ts" />

// @filename: a.py
//// from typing import TypedDict
////
//// class Post(TypedDict, total=False):
////     [|title|] : str
////     author: 'Author'
////
//// class AuthorOptionalData(TypedDict, total=False):
////     [|age|]: int
////
//// class Author(AuthorOptionalData):
////     [|name|] : str
////
//// Profile = TypedDict(
////     'Profile',
////     {
////         'bio': str,
////         [|'views'|]: int,
////     },
////     total=False,
//// )

// @filename: test.py
//// from a import Post, Author, Profile
////
//// author: Author = {[|/*marker1*/'name'|]: 'Robert'}
//// post: Post = {'author': {[|/*marker2*/'name'|]}}
//// profile: Profile = {[|/*marker3*/'views'|]: 100}
//// author: Author = {'name': 'Robert', [|/*marker4*/'age'|]: 67}
////
//// def foo(item: Post | Author) -> None:
////     ...
////
//// foo(item={[|/*marker5*/'title'|]})
//// foo(item={'title': [|/*marker6*/'title'|]})
//// foo(item={[|/*marker7*/'name'|]})

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: rangeMap
                    .get('name')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker2: {
                definitions: rangeMap
                    .get('name')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker3: {
                definitions: rangeMap
                    .get("'views'")!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker4: {
                definitions: rangeMap
                    .get('age')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker5: {
                definitions: rangeMap
                    .get('title')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker6: {
                definitions: [],
            },
            marker7: {
                definitions: rangeMap
                    .get('name')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
