import { ParseNode } from 'pyright-internal/parser/parseNodes';
import { metaDescriptor, packageDescriptor } from './lsif-typescript/Descriptor';
import { LsifSymbol } from './LsifSymbol';
import { TreeVisitor } from './treeVisitor';

export function pythonModule(visitor: TreeVisitor, node: ParseNode, moduleName: string): LsifSymbol {
    let pythonPackage = visitor.getPackageInfo(node, moduleName);
    if (pythonPackage) {
        return LsifSymbol.global(
            LsifSymbol.global(
                LsifSymbol.package(pythonPackage.name, pythonPackage.version),
                packageDescriptor(moduleName)
            ),
            metaDescriptor('__init__')
        );
    } else {
        return LsifSymbol.local(12341234);
    }
}
