
"use strict";

const assert = require('assert');
const esprima = require('esprima');

const {DepthCache} = require('./depth_cache');
const ast = require('./ast');

function jsonStr(obj, pretty) {
    if (pretty) {
        return JSON.stringify(obj, "utf8", pretty);
    } else {
        return JSON.stringify(obj);
    }
}

/**
 * Notes on compression.  Relative-path can be
 * described as composition of:
 *      - Parent [move to parent]
 *      - Child [move to last child]
 *      - Sibling [move to previous sibling]
 *      - Nop [nothing]
 *
 * This can be encoded in 2 bits.  A var-length
 * encoding can pack paths of length `3 + 4*(b-1)`
 * in a sequence of `b` bytes.
 *
 * This is used in the calculation of whether to
 * emit a backreference or not.
 */

function dump_lifted(js_str) {
    const raw_ast = esprima.parseScript(js_str, {});
    const lifted_ast = ast.NodeType.mustLiftObj(raw_ast);
    prePostWalk(lifted_ast, printVisitor);
}

function dump_type_sorted(js_str) {
    const raw_ast = esprima.parseScript(js_str, {});
    const lifted_ast = ast.NodeType.mustLiftObj(raw_ast);
    // Walk and print the AST.
    //prePostWalk(lifted_ast, printVisitor);

    // Make a type-sorted index of all the subtrees.
    const type_map = new Map();
    prePostWalk(lifted_ast, makeSortVisitor(type_map));

    // Walk each of those sorted by type and print them.
    for (let [type_name, node_set] of type_map.entries()) {
        console.log('#########');
        console.log(`###### TYPE ${type_name} ######`);
        console.log('#');
        for (let {node, attrs} of node_set) {
            console.log(` ==> Node ${attrs.number}`);
            prePostWalk(node, printVisitor);
        }
    }
}

function compress(js_str) {
    const result = [];
    const raw_ast = esprima.parseScript(js_str, {range: true, loc: true});
    const lifted_ast = ast.NodeType.mustLiftObj(raw_ast);
    lifted_ast.depthFirstNumber();
    // Walk and print the AST.
    //prePostWalk(lifted_ast, printVisitor);

    // Make a type-sorted index of all the subtrees.
    prePostWalk(lifted_ast, makeCompressVisitor());
}

function makeCompressVisitor() {
    let depth_cache = new DepthCache();

    // This is a map of nodes to templates, so that
    // we add the template for the node to the dictionary
    // when 'ending' the subtree at a given node.
    let template_map = new Map();

    return function (when, node, attrs) {
        if (when == 'begin') {
            assert(node && node.type);

            console.log(`--- BEGIN ${node.summaryString()}`);

            // Search for matching entries
            // in the cache.
            const match = depth_cache.search(node.attrs.depth, node);
            if (!match.ref) {
                return;
            }
            const {ref, prior_tree, prior_template,
                   benefit, cuts} = match;
            let {step_count, cut_count, template} = {};
            if (match.prior_template) {
                step_count = match.prior_template.step_count;
                cut_count = match.prior_template.cut_count;
            } else {
                step_count = match.step_count;
                cut_count = match.cut_count;
                template_map.set(node.attrs.number, match.template);
            }
            console.log(`${ref}: ${node.summaryString().replace(/ /g, '_')}` +
                        ` BENEFIT:${benefit}` +
                        ` s/c=${step_count}/${cut_count}`);
            if (prior_tree) {
                console.log(`        ${prior_tree.summaryString()} - ` +
                            prior_tree.toString().replace(/\n/, '\n        '));
            } else {
                console.log(`        ${prior_template.tree.summaryString()}` +
                            prior_template.tree.toString().replace(/\n/, '\n        '));
            }
            const children = [];
            cuts.forEach((cut, i) => {
                const {reason, num, subst} = cut;
                if (subst.value) {
                    const value_str = subst.value.valueString();
                    console.log(`  #CutField[${i}]@${num} ${value_str} (${reason})`);
                } else if (subst.value_map) {
                    console.log(`  #CutAllFields[${i}]@${num} - (${reason})`);
                    subst.value_map.forEach((v, k) => {
                        const v_str = v.valueString();
                        console.log(`    * ${k}=${v_str}`);
                    });
                } else if (subst.node) {
                    const type_name = subst.node.type.name;
                    console.log(`  #CutChild[${i}]@${num} ${subst.node.summaryString()} - (${reason})`);
                    children.push({name:ref, child:subst.node});
                } else if (subst.node_array) {
                    console.log(`  #CutChildArray[${i}]@${num} - ${reason}`);
                    children.push({name:ref, child:subst.node_array});
                    for (let i = 0; i < subst.node_array.length; i++) {
                        const node = subst.node_array[i];
                        const type_name = node.type.name;
                        console.log(`    ${i} => ${node.summaryString()}`);
                    }
                }
            });
            return children;
        } else if (when == 'end') {
            console.log(`--- END ${node.summaryString()}`);
            assert(node && node.type);
            // Push the subtree after it's completed
            // emitting.
            depth_cache.pushTree(node.attrs.depth, node);

            // If a template was generated from
            // encoding this subtree, push that.
            const template = template_map.get(node.attrs.number);
            if (template) {
                depth_cache.pushTemplate(node.attrs.depth, template);
                template_map.delete(node.attrs.number);
            }
        }
    }
};

function makeSortVisitor(type_map) {
    return function (when, node, attrs) {
        if (when != 'begin') {
            return;
        }

        const name = node.type.name;
        if (!type_map.has(name)) {
            type_map.set(name, new Set());
        }

        type_map.get(name).add({node, attrs});
    }
};

function printVisitor(when, node, attrs) {
    const shelf = "    ".repeat(attrs.depth);
    const output = [];
    if (when == 'begin') {
        output.push(shelf, attrs.disp_name);
        output.push(": ", node.type.short_name);
        if (node.parentNode()) {
            const parent_name = node.parentNode().type.short_name;
            output.push(` @ ${parent_name}`);
        }
        if (node.numFields() > 0) {
            output.push("\n");
        }
        node.forEachField((field, name) => {
            let field_str = field.valueString();
            if (field_str.length > 10) {
                field_str = field_str.substr(0, 15) + '...';
            }
            output.push(shelf, "^ ");
            output.push(name, "=", field_str, "\n");
        });
    } else if (when == 'end') {
        if (node.numChildren() > 0) {
            output.push(shelf, "/", attrs.name, ": ", node.type.short_name);
        } else{
            output.push("\n");
        }
    } else if (when == 'empty_array') {
        output.push(shelf, attrs.name, " = [<empty>]", "\n");
    }
    const output_str = output.join("").replace(/\n$/, '');
    for (let line of output_str.split("\n")) {
        console.log("LINE: " + line);
    }
}

function prePostWalk(lifted_ast, cb) {
    const state = {number: 0};
    prePostWalkHelper(lifted_ast, cb, {
        parent: null,
        name: '<root>',
        disp_name: '<root>',
        depth: 0,
        number: state.number,
        _state: state
    });
}

function prePostWalkHelper(node, cb, attrs) {
    // Begin the current node.
    let children = cb('begin', node, attrs);
    if (children === false) {
        return false;
    }
    // No children returned, take direct children.
    if (!Array.isArray(children)) {
        children = [];
        node.forEachChild((child, name) => {
            children.push({name, child});
        });
    }

    // Walk each of the children.
    for (let {name, child} of children) {
        const is_array = Array.isArray(child);
        const chs = is_array ? child : [child];

        const proto_child_attrs = {
            parent: node,
            name: name,
            disp_name: '',
            depth: attrs.depth + 1,
            number: 0,
            _state: attrs._state
        };

        if (is_array && chs.length == 0) {
            const child_attrs = {};
            Object.assign(child_attrs, proto_child_attrs);
            if (cb('empty_array', null, child_attrs) === false) {
                return false;
            }
            return;
        }

        let brk = false;
        chs.forEach((ch, i) => {
            if (brk) { return; }
            if (!ch) {
                // All array entries should be valid.
                assert(!is_array);
                return;
            }
            const number = ++attrs._state.number;
            const disp_name = name + (is_array ? '.' + i : '');
            const child_attrs = {};
            Object.assign(child_attrs, proto_child_attrs,
                          {disp_name, number});
            if (prePostWalkHelper(ch, cb, child_attrs) === false) {
                brk = true;
            }
        });
        if (brk) {
            return false;
        }
    }

    // End the current node.
    if (cb('end', node, attrs) === false) {
        return false;
    }
}

module.exports = { dump_lifted, dump_type_sorted, compress };
