#!/usr/bin/env python3
"""
TSP JSON Generator for Type Server Protocol

This script parses the typeServerProtocol.ts file and updates the tsp.json file
to maintain the existing format while ensuring all current requests and 
notifications are included with their proper types.

The script maintains the original tsp.json structure:
- metaData with version
- requests array with method, typeName, result, messageDirection, params, documentation
- notifications array with method, typeName, messageDirection, params, documentation
- types object with all interface, enum, and type definitions
"""

import json
import re
import os
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional, Set, Tuple
from pathlib import Path

class TSPJsonGenerator:
    """Generator for TSP JSON format"""
    
    def __init__(self):
        self.requests = []
        self.notifications = []
        self.types = {}
        self.enums = {}
        self.interfaces = {}
        self.type_aliases = {}
        self.current_version = "0.2.0"
        self.original_content = ""
    
    def _find_brace_content(self, text: str, start_pos: int) -> Optional[str]:
        """Find content between matching braces starting at start_pos"""
        if start_pos >= len(text) or text[start_pos] != '{':
            return None
        depth = 1
        i = start_pos + 1
        while i < len(text) and depth > 0:
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            i += 1
        return text[start_pos+1:i-1]
        
    def parse_typescript_file(self, file_path: str) -> None:
        """Parse the TypeScript file and extract all definitions"""
        with open(file_path, 'r', encoding='utf-8') as f:
            self.original_content = f.read()
        
        # Create a version without comments for parsing structure
        content_no_comments = self._remove_comments(self.original_content)
        
        # Parse all type definitions first (using original content with comments)
        self._parse_enums(self.original_content)
        self._parse_interfaces(self.original_content)
        self._parse_type_aliases(self.original_content)
        
        # Parse namespaces (using content without comments for easier parsing)
        self._parse_namespaces(content_no_comments)
        
        print("=== PARSING RESULTS ===")
        print(f"Found {len(self.requests)} requests")
        print(f"Found {len(self.notifications)} notifications")
        print(f"Found {len(self.enums)} enums") 
        print(f"Found {len(self.interfaces)} interfaces")
        print(f"Found {len(self.type_aliases)} type aliases")
        
        print("\n=== REQUEST MESSAGES ===")
        for req in sorted(self.requests, key=lambda x: x['method']):
            print(f"  - {req['method']} ({req['typeName']})")
            
        print("\n=== NOTIFICATION MESSAGES ===")
        for notif in sorted(self.notifications, key=lambda x: x['method']):
            print(f"  - {notif['method']} ({notif['typeName']})")

        print("\n=== TYPE DEFINITIONS ===")
        print(f"Enums: {', '.join(sorted(self.enums.keys()))}")
        print(f"Interfaces: {', '.join(sorted(self.interfaces.keys()))}")
        print(f"Type Aliases: {', '.join(sorted(self.type_aliases.keys()))}")
    
    def _remove_comments(self, content: str) -> str:
        """Remove TypeScript comments from content"""
        # Remove single-line comments
        content = re.sub(r'//.*$', '', content, flags=re.MULTILINE)
        # Remove multi-line comments
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        return content
    
    def _parse_enums(self, content: str) -> None:
        """Parse enum definitions with documentation"""
        # Use a simpler approach to extract documentation
        lines = content.split('\n')
        
        # Find all enum definitions with their line numbers
        enum_positions = []
        for i, line in enumerate(lines):
            enum_match = re.match(r'\s*export\s+(?:const\s+)?enum\s+(\w+)\s*\{', line)
            if enum_match:
                enum_positions.append((i, enum_match.group(1)))
        
        # Process each enum
        for line_num, enum_name in enum_positions:
            # Look for the immediate preceding comment(s)
            enum_doc = ""
            comment_lines = []
            j = line_num - 1
            
            # Collect all consecutive comment lines
            while j >= 0:
                prev_line = lines[j].strip()
                if prev_line.startswith('//'):
                    # Found a single-line comment
                    comment_text = prev_line[2:].strip()
                    if comment_text:
                        comment_lines.insert(0, comment_text)  # Insert at beginning to maintain order
                elif prev_line == '':
                    # Empty line, continue looking for more comments
                    pass
                elif prev_line == '}':
                    # End of previous block, continue looking
                    pass
                else:
                    # Non-comment, non-empty line - stop looking
                    break
                j -= 1
            
            # Join all comment lines
            if comment_lines:
                enum_doc = ' '.join(comment_lines)
            
            # Extract the enum body using regex
            enum_pattern = rf'export\s+(?:const\s+)?enum\s+{re.escape(enum_name)}\s*\{{([^}}]+)\}}'
            enum_match = re.search(enum_pattern, content, re.DOTALL)
            if not enum_match:
                continue
                
            enum_body = enum_match.group(1)
            
            enum_values = []  # For stringLiteral: just names
            enum_values_dict = {}  # For stringEnum: name -> value mapping
            enum_descriptions = {}
            has_string_values = False
            
            # Split by lines and process each line
            body_lines = enum_body.split('\n')
            for line in body_lines:
                line = line.strip()
                if not line or line.startswith('//') or line == '}':
                    continue
                
                # Extract comment from the line
                comment_match = re.search(r'//\s*(.*)', line)
                member_comment = comment_match.group(1).strip() if comment_match else None
                
                # Remove comment from line to get the member definition
                clean_line = re.sub(r'//.*', '', line).strip().rstrip(',')
                
                if not clean_line:
                    continue
                
                # Parse member definition - check for string value assignment like: v0_1_0 = '0.1.0'
                member_match = re.match(r'(\w+)(?:\s*=\s*([\'"][^\'"]+[\'"]|[^,]+))?', clean_line)
                if not member_match:
                    continue
                
                member_name = member_match.group(1).strip()
                member_value_raw = member_match.group(2)
                
                if not member_name:
                    continue
                
                # Check if this has a string value
                if member_value_raw:
                    member_value_raw = member_value_raw.strip()
                    # Check for string literal value (quoted)
                    string_val_match = re.match(r'[\'"](.+)[\'"]', member_value_raw)
                    if string_val_match:
                        has_string_values = True
                        enum_values_dict[member_name] = string_val_match.group(1)
                    else:
                        # Numeric or other value - still add to list
                        enum_values_dict[member_name] = member_name
                else:
                    enum_values_dict[member_name] = member_name
                
                # Store member documentation
                if member_comment:
                    enum_descriptions[member_name] = member_comment
                
                # Add member name to values list
                enum_values.append(member_name)
            
            # Convert to TSP format - use stringEnum if has string values, otherwise stringLiteral
            if has_string_values:
                enum_def = {
                    "kind": "stringEnum",
                    "values": enum_values_dict
                }
            else:
                enum_def = {
                    "kind": "stringLiteral",
                    "value": enum_values
                }
            
            if enum_doc:
                enum_def["documentation"] = enum_doc
            
            if enum_descriptions:
                enum_def["valueDocumentation"] = enum_descriptions
            
            self.enums[enum_name] = enum_def
    
    def _parse_interfaces(self, content: str) -> None:
        """Parse interface definitions with documentation"""
        # Use a simpler approach similar to enums - line by line parsing
        lines = content.split('\n')
        
        # Find all interface definitions with their line numbers
        # Match generic interfaces like: interface TypeBase<T extends TypeKind>
        interface_positions = []
        for i, line in enumerate(lines):
            # Match: export interface Name<...> extends ... { or export interface Name extends ... {
            interface_match = re.match(r'\s*export\s+interface\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+([^{]+))?\s*\{', line)
            if interface_match:
                interface_positions.append((i, interface_match.group(1), interface_match.group(2)))
        
        # Process each interface
        for line_num, interface_name, extends_clause in interface_positions:
            # Look for the immediate preceding comment(s) using the same logic as enums
            interface_doc = ""
            comment_lines = []
            j = line_num - 1
            in_block_comment = False
            
            # Collect consecutive comment lines immediately before the interface
            while j >= 0:
                prev_line = lines[j].strip()
                
                if prev_line.endswith('*/') and '/**' in prev_line:
                    # Single-line JSDoc comment
                    jsdoc_text = prev_line[prev_line.find('/**')+3:prev_line.rfind('*/')].strip()
                    if jsdoc_text:
                        comment_lines.insert(0, jsdoc_text)
                    break
                elif prev_line.endswith('*/'):
                    # End of multi-line JSDoc comment
                    in_block_comment = True
                    if prev_line != '*/':
                        # There's content on the same line
                        content_part = prev_line[:prev_line.rfind('*/')].strip()
                        if content_part.startswith('*'):
                            content_part = content_part[1:].strip()
                        if content_part:
                            comment_lines.insert(0, content_part)
                elif in_block_comment:
                    if prev_line.startswith('/**'):
                        # Start of multi-line JSDoc comment
                        content_part = prev_line[3:].strip()
                        if content_part and not content_part.startswith('*'):
                            comment_lines.insert(0, content_part)
                        break
                    elif prev_line.startswith('*'):
                        # Middle line of JSDoc comment
                        content_part = prev_line[1:].strip()
                        if content_part:
                            comment_lines.insert(0, content_part)
                elif prev_line.startswith('//'):
                    # Single-line comment
                    comment_text = prev_line[2:].strip()
                    if comment_text:
                        comment_lines.insert(0, comment_text)
                elif prev_line == '':
                    # Empty line, continue looking
                    pass
                elif prev_line == '}':
                    # End of previous block, stop here to avoid collecting from previous definitions
                    break
                else:
                    # Non-comment, non-empty line - stop looking
                    break
                j -= 1
            
            # Join all comment lines
            if comment_lines:
                interface_doc = ' '.join(comment_lines)
            
            # Extract the interface body using brace matching (handles nested braces in comments)
            interface_pattern = rf'export\s+interface\s+{re.escape(interface_name)}(?:<[^>]+>)?(?:\s+extends\s+[^{{]+)?\s*\{{'
            interface_match = re.search(interface_pattern, content)
            if not interface_match:
                continue
            
            brace_start = interface_match.end() - 1  # Position of {
            interface_body = self._find_brace_content(content, brace_start)
            if interface_body is None:
                continue
                
            properties = self._parse_interface_properties(interface_body)
            
            interface_def = {
                "kind": "interface",
                "properties": properties
            }
            
            if interface_doc:
                interface_def["documentation"] = interface_doc
            
            if extends_clause:
                # Handle inheritance - strip generic parameters from base types
                base_types = []
                for t in extends_clause.split(','):
                    base = t.strip()
                    # Strip generic parameters like <TypeKind.BuiltIn> or <DeclarationKind.Regular>
                    generic_match = re.match(r'(\w+)(?:<[^>]+>)?', base)
                    if generic_match:
                        base_types.append(generic_match.group(1))
                interface_def["extends"] = [{"kind": "reference", "name": base} for base in base_types]
            
            self.interfaces[interface_name] = interface_def
    
    def _parse_interface_properties(self, body: str) -> List[Dict[str, Any]]:
        """Parse properties from an interface body with documentation"""
        properties = []
        
        # Split by lines and process each property
        lines = body.split('\n')
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            
            # Skip empty lines and comments
            if not line or line.startswith('//') or line.startswith('/*'):
                i += 1
                continue
            
            # Collect comment lines before the property
            comment_lines = []
            
            # Look backwards for comment lines that immediately precede this property
            j = i - 1
            consecutive_empty_lines = 0
            while j >= 0:
                prev_line = lines[j].strip()
                if prev_line.startswith('//'):
                    comment_text = prev_line[2:].strip()
                    if comment_text:
                        comment_lines.insert(0, comment_text)
                    consecutive_empty_lines = 0
                elif not prev_line:  # empty line
                    consecutive_empty_lines += 1
                    # Stop if we hit too many empty lines (likely a separation between property groups)
                    if consecutive_empty_lines > 1:
                        break
                else:
                    # Hit a non-comment, non-empty line (property definition, brace, etc.) - stop collecting
                    break
                j -= 1
            
            # Parse property definition
            prop_match = re.match(r'(?:readonly\s+)?(\w+)(\?)?:\s*([^;,\n]+)[;,]?', line)
            if prop_match:
                prop_name = prop_match.group(1)
                is_optional = prop_match.group(2) == '?'
                prop_type = prop_match.group(3).strip().rstrip(';,').strip()
                
                # Check if the type ends with "| undefined" - make it optional and strip undefined
                type_for_conversion, made_optional = self._handle_undefined_in_type(prop_type)
                if made_optional:
                    is_optional = True
                
                prop_def = {
                    "name": prop_name,
                    "type": self._typescript_to_tsp_type(type_for_conversion),
                    "optional": is_optional
                }
                
                if comment_lines:
                    prop_def["documentation"] = " ".join(comment_lines)
                
                properties.append(prop_def)
            
            i += 1
        
        return properties
    
    def _clean_comment(self, comment: str) -> str:
        """Clean up a block comment by removing * and extra whitespace"""
        lines = comment.split('\n')
        cleaned_lines = []
        for line in lines:
            # Remove leading/trailing whitespace and * characters
            cleaned = line.strip().lstrip('*').strip()
            if cleaned:
                cleaned_lines.append(cleaned)
        return ' '.join(cleaned_lines)
    
    def _handle_undefined_in_type(self, ts_type: str) -> Tuple[str, bool]:
        """
        Handle 'undefined' in types by converting to optional.
        Returns (cleaned_type, is_optional).
        
        Examples:
        - "Type | undefined" -> ("Type", True)
        - "(Type | undefined)[] | undefined" -> ("(Type | undefined)[]", True)
        - "Type" -> ("Type", False)
        """
        ts_type = ts_type.strip()
        
        # Check if the top-level type ends with "| undefined"
        # Need to handle nested structures properly
        parts = self._split_union_type(ts_type)
        
        # Check if undefined is one of the top-level union parts
        if 'undefined' in parts:
            # Remove undefined from the parts
            parts = [p for p in parts if p != 'undefined']
            if len(parts) == 1:
                return (parts[0], True)
            else:
                # Reconstruct the union without undefined
                return (' | '.join(parts), True)
        
        return (ts_type, False)
    
    def _parse_type_aliases(self, content: str) -> None:
        """Parse type alias definitions with documentation"""
        # Match type alias with optional leading comment
        type_pattern = r'(?://\s*(.*?)\n\s*)?export\s+type\s+(\w+)\s*=\s*([^;]+);'
        
        for match in re.finditer(type_pattern, content):
            type_comment = match.group(1)
            type_name = match.group(2)
            type_def = match.group(3).strip()
            
            alias_def = {
                "kind": "alias",
                "type": self._typescript_to_tsp_type(type_def)
            }
            
            if type_comment:
                alias_def["documentation"] = type_comment.strip()
            
            self.type_aliases[type_name] = alias_def
    
    def _typescript_to_tsp_type(self, ts_type: str) -> Optional[Dict[str, Any]]:
        """Convert TypeScript type to TSP format"""
        ts_type = ts_type.strip()
        
        # Handle parenthesized types like (Type | undefined)[]
        paren_array_match = re.match(r'\(([^)]+)\)\[\]', ts_type)
        if paren_array_match:
            inner_type = paren_array_match.group(1).strip()
            return {
                "kind": "array",
                "element": self._typescript_to_tsp_type(inner_type)
            }
        
        # Handle basic types (filter out bigint as it's not portable)
        if ts_type in ['string', 'number', 'boolean', 'integer']:
            return {"kind": "base", "name": ts_type}
        
        # bigint is not portable to some languages, skip it
        if ts_type == 'bigint':
            return None  # Will be filtered out
        
        if ts_type == 'undefined':
            return {"kind": "base", "name": "null"}
        
        # Check if this is a string literal union like 'unknown' | 'any' | ...
        # These should become a simple string base type
        if re.match(r"^'[^']+'\s*(\|\s*'[^']+'\s*)*$", ts_type):
            return {"kind": "base", "name": "string"}
        
        # Handle union types
        if ' | ' in ts_type:
            union_parts = self._split_union_type(ts_type)
            union_items = []
            for part in union_parts:
                part = part.strip()
                # Skip bigint in unions (not portable)
                if part == 'bigint':
                    continue
                # Convert undefined to null in unions (for nested types like array elements)
                if part == 'undefined':
                    union_items.append({"kind": "base", "name": "null"})
                elif part:
                    item = self._typescript_to_tsp_type(part)
                    if item is not None:  # Filter out None (from bigint)
                        union_items.append(item)
            if len(union_items) == 0:
                return {"kind": "base", "name": "null"}
            elif len(union_items) == 1:
                return union_items[0]
            return {"kind": "or", "items": union_items}
        
        # Handle array types
        if ts_type.endswith('[]'):
            element_type = ts_type[:-2].strip()
            return {
                "kind": "array",
                "element": self._typescript_to_tsp_type(element_type)
            }
        
        # Handle Array<T> syntax
        array_match = re.match(r'Array<(.+)>', ts_type)
        if array_match:
            element_type = array_match.group(1)
            return {
                "kind": "array", 
                "element": self._typescript_to_tsp_type(element_type)
            }
        
        # Everything else is a reference type - strip generic parameters
        ref_match = re.match(r'(\w+)(?:<[^>]+>)?', ts_type)
        if ref_match:
            return {"kind": "reference", "name": ref_match.group(1)}
        return {"kind": "reference", "name": ts_type}
    
    def _split_union_type(self, union_type: str) -> List[str]:
        """Split a union type by | while respecting nested structures"""
        parts = []
        current = ""
        depth = 0
        
        i = 0
        while i < len(union_type):
            char = union_type[i]
            
            if char in '<([{':
                depth += 1
                current += char
            elif char in '>)]}':
                depth -= 1
                current += char
            elif char == '|' and depth == 0:
                if current.strip():
                    parts.append(current.strip())
                current = ""
            else:
                current += char
            
            i += 1
        
        if current.strip():
            parts.append(current.strip())
        
        return parts
    
    def _parse_namespaces(self, content: str) -> None:
        """Parse request and notification namespace definitions"""
        lines = content.split('\n')
        in_namespace = False
        namespace_name = ""
        namespace_content = []
        brace_count = 0
        
        for line in lines:
            # Check for namespace start
            namespace_match = re.match(r'\s*export\s+namespace\s+(\w+)\s*\{', line)
            if namespace_match:
                if in_namespace:
                    # Process previous namespace
                    self._process_namespace(namespace_name, '\n'.join(namespace_content))
                
                # Start new namespace
                namespace_name = namespace_match.group(1)
                namespace_content = []
                in_namespace = True
                brace_count = 1
                # Add the rest of the line after the opening brace
                remaining = line[namespace_match.end()-1:]  # Include the opening brace
                if len(remaining) > 1:  # More than just the opening brace
                    namespace_content.append(remaining[1:])  # Skip the opening brace
                continue
            
            if in_namespace:
                # Count braces to find the end of the namespace
                brace_count += line.count('{') - line.count('}')
                
                if brace_count > 0:
                    namespace_content.append(line)
                else:
                    # End of namespace found
                    # Add the line content before the closing brace
                    closing_brace_pos = line.rfind('}')
                    if closing_brace_pos > 0:
                        namespace_content.append(line[:closing_brace_pos])
                    
                    # Process the namespace
                    self._process_namespace(namespace_name, '\n'.join(namespace_content))
                    
                    in_namespace = False
                    namespace_name = ""
                    namespace_content = []
        
        # Process the last namespace if we ended inside one
        if in_namespace and namespace_name:
            self._process_namespace(namespace_name, '\n'.join(namespace_content))
    
    def _process_namespace(self, name: str, body: str) -> None:
        """Process a namespace (request or notification)"""
        if 'Request' in name:
            self._parse_request_namespace(name, body)
        elif 'Notification' in name:
            self._parse_notification_namespace(name, body)
    
    def _parse_request_namespace(self, name: str, body: str) -> None:
        """Parse a request namespace and extract the request definition"""
        method_match = re.search(r"method\s*=\s*['\"]([^'\"]+)['\"]", body)
        direction_match = re.search(r"messageDirection\s*=\s*MessageDirection\.(\w+)", body)
        
        # Distinguish between ProtocolRequestType0 (no params) and ProtocolRequestType (has params)
        type0_match = re.search(r"type\s*=\s*new\s+ProtocolRequestType0<([^>]*)>", body, re.DOTALL)
        type_match = re.search(r"type\s*=\s*new\s+ProtocolRequestType<([^>]*(?:[^<>]*<[^<>]*>[^<>]*)*[^>]*)>", body, re.DOTALL)
        
        if not method_match:
            return
            
        method = method_match.group(1)
        direction = direction_match.group(1) if direction_match else "clientToServer"
        
        # Extract documentation from the namespace comment
        documentation = self._extract_documentation_from_namespace(name, body)
        
        request_def = {
            "method": method,
            "typeName": name,
            "messageDirection": direction,
            "documentation": documentation
        }
        
        if type0_match:
            # ProtocolRequestType0<ResultType, ErrorType, RegistrationOptionsType, void>
            # First param is the result type, no params
            type_params_str = type0_match.group(1)
            type_params_str = re.sub(r'\s+', ' ', type_params_str.strip())
            params = self._split_type_params(type_params_str)
            
            if len(params) >= 1 and params[0] != 'void' and params[0] != 'never':
                result_type = self._parse_single_type(params[0])
                if result_type:
                    request_def["result"] = result_type
        elif type_match:
            type_params_str = type_match.group(1)
            type_params_str = re.sub(r'\s+', ' ', type_params_str.strip())
            
            # Parse parameters and result types
            params_type, result_type = self._parse_request_types(type_params_str)
            
            if params_type:
                request_def["params"] = params_type
            
            if result_type:
                request_def["result"] = result_type
        
        self.requests.append(request_def)
    
    def _parse_notification_namespace(self, name: str, body: str) -> None:
        """Parse a notification namespace and extract the notification definition"""
        method_match = re.search(r"method\s*=\s*['\"]([^'\"]+)['\"]", body)
        direction_match = re.search(r"messageDirection\s*=\s*MessageDirection\.(\w+)", body)
        type_match = re.search(r"type\s*=\s*new\s+ProtocolNotificationType<([^>]+)>", body, re.DOTALL)
        
        if not method_match:
            return
            
        method = method_match.group(1)
        direction = direction_match.group(1) if direction_match else "serverToClient"
        
        # Extract documentation from the namespace comment
        documentation = self._extract_documentation_from_namespace(name, body)
        
        notification_def = {
            "method": method,
            "typeName": name,
            "messageDirection": direction,
            "documentation": documentation
        }
        
        if type_match:
            type_params_str = type_match.group(1)
            type_params_str = re.sub(r'\s+', ' ', type_params_str.strip())
            
            # Parse parameters type
            params_type = self._parse_single_type(type_params_str.split(',')[0].strip())
            
            if params_type:
                notification_def["params"] = params_type
        
        self.notifications.append(notification_def)
    
    def _extract_documentation_from_namespace(self, name: str, body: str) -> str:
        """Extract documentation from TypeScript comments above the namespace"""
        # Use the same line-by-line approach as for enums
        lines = self.original_content.split('\n')
        
        # Find the namespace declaration
        for i, line in enumerate(lines):
            namespace_match = re.match(rf'\s*export\s+namespace\s+{re.escape(name)}\s*\{{', line)
            if not namespace_match:
                continue
                
            # Look backwards for JSDoc or single-line comments
            comment_lines = []
            j = i - 1
            in_block_comment = False
            
            # Collect all consecutive comment lines
            while j >= 0:
                prev_line = lines[j].strip()
                
                if prev_line.endswith('*/') and '/**' in prev_line:
                    # Single-line JSDoc comment
                    jsdoc_text = prev_line[prev_line.find('/**')+3:prev_line.rfind('*/')].strip()
                    if jsdoc_text:
                        comment_lines.insert(0, jsdoc_text)
                    break
                elif prev_line.endswith('*/'):
                    # End of multi-line JSDoc comment
                    in_block_comment = True
                    if prev_line != '*/':
                        # There's content on the same line
                        content = prev_line[:prev_line.rfind('*/')].strip()
                        if content.startswith('*'):
                            content = content[1:].strip()
                        if content:
                            comment_lines.insert(0, content)
                elif in_block_comment:
                    if prev_line.startswith('/**'):
                        # Start of multi-line JSDoc comment
                        content = prev_line[3:].strip()
                        if content and not content.startswith('*'):
                            comment_lines.insert(0, content)
                        break
                    elif prev_line.startswith('*'):
                        # Middle line of JSDoc comment
                        content = prev_line[1:].strip()
                        if content:
                            comment_lines.insert(0, content)
                elif prev_line.startswith('//'):
                    # Single-line comment
                    comment_text = prev_line[2:].strip()
                    if comment_text:
                        comment_lines.insert(0, comment_text)
                elif prev_line == '':
                    # Empty line, continue looking
                    pass
                elif prev_line == '}':
                    # End of previous block, continue looking
                    pass
                else:
                    # Non-comment, non-empty line - stop looking
                    break
                j -= 1
            
            # Join all comment lines and return
            if comment_lines:
                return ' '.join(comment_lines)
            break
        
        # Fallback: return empty string if no documentation found
        return ""
    
    def _parse_request_types(self, type_params_str: str) -> Tuple[Optional[Dict], Optional[Dict]]:
        """Parse request type parameters and return (params_type, result_type)"""
        params_type = None
        result_type = None
        
        if type_params_str.startswith('{'):
            # Handle inline object type for parameters
            brace_count = 0
            obj_end = -1
            for i, char in enumerate(type_params_str):
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        obj_end = i + 1
                        break
            
            if obj_end > 0:
                params_obj = type_params_str[:obj_end]
                params_type = self._parse_inline_object_type(params_obj)
                
                # Get the result type (second parameter)
                remaining = type_params_str[obj_end:].strip().lstrip(',').strip()
                if remaining:
                    result_parts = self._split_type_params(remaining)
                    if len(result_parts) > 0:
                        result_type_str = result_parts[0].strip()
                        if result_type_str and result_type_str != 'never' and result_type_str != 'void':
                            result_type = self._parse_single_type(result_type_str)
        else:
            # Handle simple parameter lists
            params = self._split_type_params(type_params_str)
            
            if len(params) >= 1 and params[0] != 'void' and params[0] != 'never':
                params_type = self._parse_single_type(params[0])
            
            if len(params) >= 2 and params[1] != 'void' and params[1] != 'never':
                result_type = self._parse_single_type(params[1])
        
        return params_type, result_type
    
    def _parse_single_type(self, type_str: str) -> Optional[Dict]:
        """Parse a single TypeScript type into TSP JSON format"""
        type_str = type_str.strip()
        
        if not type_str or type_str == 'void' or type_str == 'never':
            return None
        
        return self._typescript_to_tsp_type(type_str)
    
    def _parse_inline_object_type(self, obj_str: str) -> Dict:
        """Parse an inline object type and convert to reference format"""
        # For inline object types, we'll create a reference to an appropriate interface
        # This matches the original tsp.json format which uses references
        
        # Extract property names from the inline object
        content = obj_str.strip()[1:-1]  # Remove braces
        properties = self._extract_property_names(content)
        
        # Find the best matching interface based on property similarity
        best_match = self._find_matching_interface(properties)
        
        if best_match:
            return {"kind": "reference", "name": best_match}
        else:
            # If no good match found, create an inline object type
            return self._create_inline_object_definition(content)
    
    def _extract_property_names(self, content: str) -> Set[str]:
        """Extract property names from inline object type content"""
        properties = set()
        
        # Split by semicolons and commas to get individual property definitions
        parts = re.split(r'[;,]', content)
        
        for part in parts:
            part = part.strip()
            if not part:
                continue
                
            # Match property definitions like "propertyName:" or "propertyName?:"
            prop_match = re.match(r'^\s*(\w+)\??:\s*', part)
            if prop_match:
                properties.add(prop_match.group(1))
        
        return properties
    
    def _find_matching_interface(self, properties: Set[str]) -> Optional[str]:
        """Find the interface that best matches the given properties"""
        if not properties or not self.interfaces:
            return None
            
        best_match = None
        best_score = 0
        
        # Check all known interfaces for property overlap
        for interface_name, interface_def in self.interfaces.items():
            if interface_def.get("kind") != "interface":
                continue
                
            interface_properties = set()
            for prop in interface_def.get("properties", []):
                interface_properties.add(prop.get("name", ""))
            
            # Calculate similarity score based on property overlap
            if not interface_properties:
                continue
                
            overlap = len(properties.intersection(interface_properties))
            total_props = len(properties.union(interface_properties))
            
            if total_props == 0:
                continue
                
            # Score based on Jaccard similarity (intersection over union)
            score = overlap / total_props
            
            # Bonus for exact matches or if all inline properties are found in interface
            if properties == interface_properties:
                score += 0.5  # Exact match bonus
            elif properties.issubset(interface_properties):
                score += 0.25  # Subset bonus
            
            if score > best_score and score > 0.5:  # Require at least 50% similarity
                best_score = score
                best_match = interface_name
        
        return best_match
    
    def _create_inline_object_definition(self, content: str) -> Dict:
        """Create an inline object type definition when no interface match is found"""
        properties = []
        
        # Split by semicolons and commas to get individual property definitions
        parts = re.split(r'[;,]', content)
        
        for part in parts:
            part = part.strip()
            if not part:
                continue
                
            # Match property definitions like "propertyName: Type" or "propertyName?: Type"
            prop_match = re.match(r'^\s*(\w+)(\?)?:\s*(.+)$', part)
            if prop_match:
                prop_name = prop_match.group(1)
                is_optional = prop_match.group(2) == '?'
                prop_type_str = prop_match.group(3).strip()
                
                prop_def = {
                    "name": prop_name,
                    "type": self._typescript_to_tsp_type(prop_type_str),
                    "optional": is_optional
                }
                properties.append(prop_def)
        
        return {
            "kind": "interface",
            "properties": properties
        }
    
    def _split_type_params(self, params_str: str) -> List[str]:
        """Split type parameters by commas, respecting nested structures"""
        params = []
        current = ""
        depth = 0
        
        for char in params_str:
            if char in '<{[(':
                depth += 1
            elif char in '>}])':
                depth -= 1
            elif char == ',' and depth == 0:
                if current.strip():
                    params.append(current.strip())
                current = ""
                continue
            
            current += char
        
        # Add the last parameter
        if current.strip():
            params.append(current.strip())
        
        return params
    
    def generate_tsp_json(self) -> Dict[str, Any]:
        """Generate the TSP JSON in the correct format"""
        # Add LSP imported types that are referenced but not defined locally
        self._add_lsp_types()
        
        # Combine all types
        all_types = {}
        all_types.update(self.enums)
        all_types.update(self.interfaces)
        all_types.update(self.type_aliases)
        
        return {
            "metaData": {
                "version": self.current_version
            },
            "requests": sorted(self.requests, key=lambda x: x['method']),
            "notifications": sorted(self.notifications, key=lambda x: x['method']),
            "types": all_types
        }
    
    def _add_lsp_types(self) -> None:
        """Add LSP types that are imported from vscode-languageserver-protocol.
        
        These types are defined in the LSP spec and imported into our protocol.
        We generate their definitions based on the LSP specification.
        """
        # Check if Range is imported and used but not defined
        if 'Range' not in self.interfaces:
            # Parse the imports to see if Range is imported
            import_match = re.search(r'import\s*\{[^}]*Range[^}]*\}\s*from\s*[\'"]vscode-languageserver-protocol[\'"]', self.original_content)
            if import_match:
                # Range is imported from LSP - add its definition
                self.interfaces['Range'] = {
                    "kind": "interface",
                    "properties": [
                        {
                            "name": "start",
                            "type": {"kind": "reference", "name": "Position"},
                            "optional": False,
                            "documentation": "The range's start position."
                        },
                        {
                            "name": "end",
                            "type": {"kind": "reference", "name": "Position"},
                            "optional": False,
                            "documentation": "The range's end position."
                        }
                    ],
                    "documentation": "A range in a text document expressed as (zero-based) start and end positions."
                }
        
        # Check if Position is needed (referenced by Range)
        if 'Position' not in self.interfaces and 'Range' in self.interfaces:
            self.interfaces['Position'] = {
                "kind": "interface",
                "properties": [
                    {
                        "name": "line",
                        "type": {"kind": "base", "name": "uinteger"},
                        "optional": False,
                        "documentation": "Line position in a document (zero-based)."
                    },
                    {
                        "name": "character",
                        "type": {"kind": "base", "name": "uinteger"},
                        "optional": False,
                        "documentation": "Character offset on a line in a document (zero-based)."
                    }
                ],
                "documentation": "Position in a text document expressed as zero-based line and character offset."
            }

def main():
    """Main function to generate/update the TSP JSON"""
    script_dir = Path(__file__).parent
    ts_file = script_dir / "typeServerProtocol.ts"
    json_file = script_dir / "tsp.json"
    
    if not ts_file.exists():
        print(f"Error: TypeScript file not found: {ts_file}")
        sys.exit(1)
    
    print(f"Parsing TypeScript file: {ts_file}")
    print(f"Updating TSP JSON file: {json_file}")
    print()
    
    generator = TSPJsonGenerator()
    generator.parse_typescript_file(str(ts_file))
    
    print("\n=== GENERATING TSP JSON ===")
    tsp_data = generator.generate_tsp_json()
    
    # Write the TSP JSON
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(tsp_data, f, indent=4)
    
    # Run prettier to format the JSON file
    try:
        import subprocess
        import os
        
        # Get the project root directory (go up from current directory to find the main workspace package.json)
        current_dir = Path(json_file).parent
        project_root = current_dir
        while project_root.parent != project_root:
            # Look for package.json with lerna configuration (indicates main workspace)
            package_json_path = project_root / 'package.json'
            if package_json_path.exists():
                try:
                    with open(package_json_path, 'r', encoding='utf-8') as f:
                        package_data = json.load(f)
                        # If it has lerna config or workspaces, it's likely the main workspace root
                        if 'workspaces' in package_data or (project_root / 'lerna.json').exists():
                            break
                except:
                    pass
            project_root = project_root.parent
        
        print(f"Info: Project root detected: {project_root}")
        
        # Try using the workspace's prettier configuration
        prettier_commands = [
            # Try npx prettier with project root as cwd
            ['npx.cmd', 'prettier', '--write', str(json_file)],
            # Try direct prettier
            ['prettier.cmd', '--write', str(json_file)]
        ]
        
        formatted = False
        for cmd in prettier_commands:
            try:
                # For npm commands, run from project root
                cwd = str(project_root) if cmd[0] in ['npm.cmd'] else None
                
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, cwd=cwd)
                    
                if result.returncode == 0:
                    print("Info: File formatted with prettier")
                    formatted = True
                    break
                else:
                    # Only print error for the first attempt (npm script)
                    if cmd[0] == 'npm.cmd':
                        print(f"Info: npm prettier failed (exit code {result.returncode}), trying alternatives...")
            except FileNotFoundError:
                # Command not found, try next one
                continue
            except subprocess.TimeoutExpired:
                print(f"Prettier command timed out: {' '.join(cmd)}")
                continue
            except Exception as e:
                print(f"Error running prettier command {' '.join(cmd)}: {e}")
                continue
        
        if not formatted:
            print("Info: Prettier not available - JSON file saved with basic formatting")
            
    except Exception as e:
        print(f"Warning: Could not run prettier: {e}")
    
    print(f"\nGenerated TSP JSON with:")
    print(f"  - Version: {tsp_data['metaData']['version']}")
    print(f"  - {len(tsp_data['requests'])} requests")
    print(f"  - {len(tsp_data['notifications'])} notifications")
    print(f"  - {len(tsp_data['types'])} type definitions")
    print(f"\nTSP JSON written to: {json_file}")

if __name__ == "__main__":
    main()