
"use strict";

const assert = require('assert');
const util = require('./util');
const {arraysEqualSimple} = util;
    

/**
 * A collection of classes and methods
 * for representing templates of attributed
 * trees.
 */

/**
 * A template just points to a node in the
 * subtree and identifies the list of cutpoints.
 */
class Template {
    constructor({tree, step_count, cut_count, cuts}) {
        this.tree = tree;
        this.step_count = step_count;
        this.cut_count = cut_count;
        this.benefit = step_count - 1;
        this.cuts = cuts;
        Object.freeze(cuts);
        Object.freeze(this);
    }

    matchesTree(query_tree) {
        const ct = new ComputeTemplate(this.tree, query_tree);
        const {step_count, cut_count, cuts} = ct.compute();
        if (step_count != this.step_count) {
            return false;
        }
        if (cut_count != this.cut_count) {
            return false;
        }
        if (cuts.length != this.cuts.length) {
            return false;
        }
        for (let i = 0; i < cuts.length; i++) {
            assert(Number.isInteger(this.cuts[i].num));
            assert(Number.isInteger(cuts[i].num));
            if (this.cuts[i].num != cuts[i].num) {
                return false;
            }
        }
        return cuts;
    }
}

class Cut {
    constructor({num, reason, descr, subst}) {
        assert(Number.isInteger(num));
        assert(typeof(reason) == 'string');
        assert(typeof(descr) == 'string');
        assert(typeof(subst) == 'string');
        this.num = num;
        this.reason = reason;
        this.descr = descr;
        this.subst = Object.freeze(Object.assign({}, subst));
        Object.freeze(this);
    }
}

/**
 * Compute the cutpoints on orig_node to produce
 * a template matching query_node.
 */
class ComputeTemplate {
    constructor(orig_node, query_node) {
        assert(orig_node !== query_node,
               `NODE ALREADY IN!??: ${orig_node.attrs.number}`);
        this.orig_node = orig_node;
        this.query_node = query_node;
        this.number = 0;
        this.child_queue = [];
        this.step_count = 0;
        this.cut_count = 0;
        this.cuts = [];
    }

    static between(orig_node, query_node) {
        const ct = new ComputeTemplate(orig_node, query_node);
        return ct.compute();
    }

    compute() {
        this.addChild_(this.orig_node, this.query_node);
        while (this.child_queue.length > 0) {
            const [orig_node, query_node] = this.child_queue.shift();
            this.matchNodes_(orig_node, query_node);
        }
        const types = `${this.orig_node.type.name}, ` +
                      `${this.query_node.type.name}`;
        return new Template({
            tree: this.orig_node,
            step_count: this.step_count,
            cut_count: this.cut_count,
            cuts: Object.freeze(this.cuts.map(c => Object.freeze(c)))
        });
    }

    step_(reason, descr, cut) {
        const num = this.number++;
        if (cut) {
            this.cut_count++;
            this.cuts.push(cut);
        } else {
            this.step_count++;
        }
        //console.log("KVKV"+` step_ ${num} reason=${reason} cut=${JSON.stringify(cut)}`);
        // TODO: call callback.
        // this.callback(num, reason, descr, cut);
    }

    cut_(reason, descr, subst) {
        const cut = {num:this.number, reason, descr, subst};
        this.step_(reason, descr, cut);
    }

    addChild_(orig, query) {
        this.child_queue.push([orig, query]);
    }

    matchNodes_(orig_node, query_node) {
        assert(orig_node && query_node);
        assert(orig_node.type && query_node.type);
        // console.log("KVKV"+` matchNodes_ orig=${orig_node.type.name} query=${query_node.type.name} num=${this.number}`);
        // Compare types of node.
        if (orig_node.type !== query_node.type) {
            // The types don't match, cut before node type.
            const descr = `orig_node(${orig_node.type.name}) !=` +
                          ` query_node(${query_node.type.name})`;
            this.cut_('node_type', descr, {node:query_node});
            return;
        }

        // Traversing through node type counts
        // as a cuttable step.
        this.step_('node_type', `${orig_node.type.name}`);

        // Compare fields of each.  If field-set names
        // do not match, cut after node type.
        const orig_fields = orig_node.fieldMap();
        const query_fields = query_node.fieldMap();

        // Compare values of all fields.  If they don't match,
        // cut.
        const orig_field_keys = Array.from(orig_fields.keys()).sort();
        const query_field_keys = Array.from(query_fields.keys()).sort();
        if (!arraysEqualSimple(orig_field_keys, query_field_keys)) {
            // Field names don't match, cut after node type.
            const descr = `orig(${orig_field_keys.join(', ')}) != ` +
                           ` query_node(${query_field_keys.join(', ')})`;
            this.cut_('field_names', descr, {value_map:query_fields});
            return;
        }

        // Traversing through matching fields counts as a cuttable step.
        //this.step_('field_names', `${orig_field_keys.join(', ')}`);

        // Iterate through field keys in order.
        orig_field_keys.forEach((field_name, i) => {
            const orig_value = orig_fields.get(field_name);
            const query_value = query_fields.get(field_name);
            const reason = `value ${i}:${field_name}`;
            if (!sameValue(orig_value, query_value)) {
                const orig_str = orig_value.valueString()
                                           .replace(/"/g, "'");
                const query_str = query_value.valueString()
                                           .replace(/"/g, "'");
                this.cut_(reason, `${orig_str} != ${query_str}`,
                          {value:query_value});
                return;
            }
        });

        // Traversing through matching fields counts as a cuttable step.
        //this.step_('fields', `${orig_field_keys.join(', ')}`);

        // Iterate through child names in order.
        const orig_children = orig_node.childMap();
        const query_children = query_node.childMap();

        const orig_child_keys = Array.from(orig_children.keys()).sort();
        const query_child_keys = Array.from(query_children.keys()).sort();
        if (!arraysEqualSimple(orig_child_keys, query_child_keys)) {
            // Child branch names don't match, cut all children.
            const descr = `orig(${orig_child_keys.join(', ')}) != ` +
                           ` query_node(${query_child_keys.join(', ')})`;
            this.cut_('child_names', descr, {node:query_node});
            return;
        }

        // All child names matching counts as a step.
        //this.step_('child_names', `${orig_child_keys.join(', ')}`);

        // Traversing through the tree top (node type, fields, child names)
        // counts as a step.
        this.step_('tree_top', `${orig_node.summaryString()} - ${orig_child_keys.join(', ')}`);

        // Add each child for bread-first search.
        orig_child_keys.forEach((child_name, i) => {
            const orig_child = orig_children.get(child_name);
            const query_child = query_children.get(child_name);
            assert(Array.isArray(orig_child) == Array.isArray(query_child));

            if (Array.isArray(orig_child)) {
                if (orig_child.length == query_child.length) {
                    // Array child lengths match.  That's a step.
                    this.step_('child_array_length',
                               `${child_name}[${orig_child.length}]`);
                    for (let i = 0; i < orig_child.length; i++) {
                        // Match each child in the array
                        this.addChild_(orig_child[i], query_child[i]);
                    }
                } else {
                    // Array child lengths don't match.  Cut
                    const descr = `${child_name}: ${orig_child.length} !=` +
                                  ` ${query_child.length}`;
                    this.cut_('child_array_length', descr,
                              {node_array:query_child});
                }
            } else if(orig_child == null) {
                if (query_child == null) {
                    this.step_('null_children', `${child_name}`);
                } else {
                    this.cut_('notnull_query_child', `${child_name}`,
                              {node:query_child});
                }
            } else {
                if (query_child == null) {
                    this.cut_('null_query_child', `${child_name}`,
                              {node:query_child});
                } else {
                    this.step_('check_children', `${child_name}`);
                    this.addChild_(orig_child, query_child);
                }
            }
        });
    }
}

function sameValue(a, b) {
    const type_a = typeof(a);
    const type_b = typeof(b);
    if ((type_a == 'object') && (type_b == 'object')) {
        return sameObjectValue(a, b);
    }
    if ((type_a == 'object') || (type_b == 'object')) {
        return false;
    }
    // Check a and b as primitives.
    return a === b;
}

function sameObjectValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length != b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!sameValue(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }

    if (Array.isArray(a) || Array.isArray(b)) {
        return false;
    }

    // If either are null, both have to be null.
    if (a === null || b === null) {
        return a === null && b === null;
    }

    // All property names must be on both objects, with
    // same values.
    const names_a = Object.getOwnPropertyNames(a).sort();
    const names_b = Object.getOwnPropertyNames(b).sort();
    if (names_a.length != names_b.length) {
        return false;
    }
    for (let i = 0; i < names_a.length; i++) {
        const name_a = names_a[i];
        const name_b = names_b[i];
        if (name_a != name_b) {
            return false;
        }
        if (!sameValue(a[name_a], b[name_a])) {
            return false;
        }
    }

    return true;
}

module.exports = { ComputeTemplate, Template };
