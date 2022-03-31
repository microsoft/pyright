import { metaDescriptor, packageDescriptor } from "./lsif-typescript/Descriptor";
import { LsifSymbol } from "./LsifSymbol";
import { TreeVisitor } from "./treeVisitor";

export function pythonModule(_visitor: TreeVisitor, moduleName: string): LsifSymbol {
  const packageSymbol = LsifSymbol.global(LsifSymbol.empty(), packageDescriptor(moduleName));
  return LsifSymbol.global(packageSymbol,metaDescriptor('__init__'));
}
