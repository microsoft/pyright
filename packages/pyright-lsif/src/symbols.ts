import { getFileInfo } from 'pyright-internal/analyzer/analyzerNodeInfo';
import { ParseNode } from 'pyright-internal/parser/parseNodes';
import { metaDescriptor, packageDescriptor } from './lsif-typescript/Descriptor';
import { LsifSymbol } from './LsifSymbol';
import { TreeVisitor } from './treeVisitor';

export function pythonModule(visitor: TreeVisitor, node: ParseNode, moduleName: string): LsifSymbol {
    let packageSymbol = LsifSymbol.empty();
    let moduleVersion = visitor.getVersion(node, moduleName);
    if (moduleVersion) {
        packageSymbol = LsifSymbol.global(LsifSymbol.package(moduleName, moduleVersion), packageDescriptor(moduleName));
    }

    return LsifSymbol.global(packageSymbol, metaDescriptor('__init__'));
}
