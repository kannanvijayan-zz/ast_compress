
/**
 * The encoder encodes as follows:
 *
 *  - Stage 1: all strings are collected and ordered by frequency
 *    of use, assigned id by order (0 = highest frequency).
 *      * Collect field names, child names, raw strings in tree.
 *  - Stage 2: all for every node, assign it a type constructed
 *    from the set `{ node } U node.field-names U child-names`
 *  - Stage 3: Start encoding.
 *      enc_node(node):
 *          enc_varuint(node_id(type_id(node)))
 *          for fn in node.field_names
 *              enc_u(string_id(fn))
 *              enc_value(node.fields[fn])
 *          for cn in node.child_names
 *              enc_u(string_id(cn))
 *              let child = node.children[cn];
 *              if is_array(child)
 *                  enc_u(child.length)
 *                  for c in child
 *                      enc_node(c)
 *              else
 *                  enc_node(c)
 *
 *      enc_treeref(rel_depth, 
 */
