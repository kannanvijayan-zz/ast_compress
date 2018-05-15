
"use strict";

const assert = require('assert');

function getOr(obj, prop, other) {
    return ((typeof(obj) == 'object') && (prop in obj))
            ? obj[prop]
            : other;
}

function jsonStr(obj, pretty) {
    if (pretty) {
        return JSON.stringify(obj, "utf8", pretty);
    } else {
        return JSON.stringify(obj);
    }
}

class FieldInfo {
    constructor(name, array, opt, del) {
        this.name = name;
        this.array = array;
        this.opt = opt;
        this.del = del;
        Object.freeze(this);
    }

    static parseNameEntry(field_str) {
        const re = /^([*?-]*)([a-zA-Z_][a-zA-Z0-9]*)/;
        const m = field_str.match(re);
        if (!m) {
            throw new Error("Bad field str: " + field_str);
        }
        const array = m[1] && (m[1].indexOf('*') >= 0);
        const opt = m[1] && (m[1].indexOf('?') >= 0);
        const del = m[1] && (m[1].indexOf('-') >= 0);
        const name = m[2];
        return new FieldInfo(name, array, opt, del);
    }

    static parseNameList(fields_str) {
        return Object.freeze(
            fields_str.split(',')
                      .filter(s => (s != ''))
                      .map(FieldInfo.parseNameEntry));
    }
}

class Field {
    constructor(field_info, value) {
        this.field_info = field_info;
        this.value = value;
    }

    valueString() {
        return jsonStr(this.value);
    }
}

class NodeType {
    constructor({name, short_name, fields, branches}) {
        assert(typeof(name) == 'string');
        assert(typeof(short_name) == 'string');
        assert(Array.isArray(fields));
        assert(Array.isArray(branches));
        this.name = name;
        this.short_name = short_name;
        this.fields = fields.filter(f => !f.del);
        this.branches = branches.filter(b => !b.del);
        this.gen_cls = BaseNode.subclassFor(this);

        this.del_fields = fields.filter(f => f.del);
        this.del_branches = branches.filter(b => b.del);
        Object.freeze(this);
    }

    static mustLiftObj(node_obj) {
        const C = NodeType.C[node_obj.type];
        if (!C) {
            throw new Error(`Unrecognized object: ${jsonStr(node_obj)}`);
        }
        return new C(node_obj);
    }
    static sloppyLiftObj(node_obj) {
        const C = NodeType.C[node_obj.type] || Unknown;
        return new C(node_obj);
    }
    static maybeLiftObj(node_obj) {
        return node_obj ? NodeType.mustLiftObj(node_obj) : null;
    }

    eachLiftedFieldInObj(node_obj, cb) {
        this.eachRawFieldInObj(node_obj, (fl, value) => {
            cb(fl.name, new Field(fl, value));
        });
    }
    eachLiftedChildInObj(node_obj, cb) {
        this.eachRawChildInObj(node_obj, (br, value) => {
            if (typeof(value) == 'object') {
                if (br.array) {
                    assert(Array.isArray(value),
                           `Array.isArray(${br.name}:${jsonStr(value)})`);
                    cb(br.name, value.map(NodeType.mustLiftObj));
                } else {
                    assert(!Array.isArray(value),
                           `!Array.isArray(${br.name}:${jsonStr(value)})`);
                    if (br.opt) {
                        cb(br.name, NodeType.maybeLiftObj(value));
                    } else {
                        cb(br.name, NodeType.mustLiftObj(value));
                    }
                }
            } else {
                if (!br.opt) {
                    throw new Error(`Did not find object child` +
                                    ` for name ${this.name}.${br.name}`);
                }
            }
        });
    }

    eachRawFieldInObj(node_obj, cb) {
        for (let fl of this.fields) {
            if (fl.name in node_obj) {
                cb(fl, node_obj[fl.name]);
            } else if (!fl.opt) {
                throw new Error(`Required field ${fl.name} ` +
                                `not found on ${fl.type.name}: ` +
                                `${jsonStr(node_obj)}`);
            }
        }
    }

    eachRawChildInObj(node_obj, cb) {
        for (let br of this.branches) {
            if (br.name in node_obj) {
                cb(br, node_obj[br.name]);
            } else if (!br.opt) {
                throw new Error(`Required field ${br.name} ` +
                                `not found on ${br.type.name}: ` +
                                `${jsonStr(node_obj)}`);
            }
        }
    }

    verifyNode(node) {
        // Do no verification on unknown nodes.
        if (this.name == NodeType.N.Unknown) {
            return;
        }

        // Ensure that there are no names on node_obj aside
        // from `type` or a named field.
        const node_obj = node.node_obj;
        const seen = new Set();
        const type = node_obj.type;
        for (let name in node_obj) {
            const val = node_obj[name];
            if (name == 'type') { continue; }
            if (name == 'range') { continue; }
            if (name == 'loc') { continue; }
            const f = this.fields.find(f => (f.name == name));
            const b = this.branches.find(b => (b.name == name));
            if (!f && !b) {
                throw new Error(`Unknown ${name}=${jsonStr(val)}` +
                                ` for kind ${type}`);
            }
            if (((f && f.array) || (b && b.array)) &&
                !Array.isArray(node_obj[name]))
            {
                throw new Error(`Field '${name}' on kind ${type}` +
                                `is not an array`);
            }
            seen.add(name);
        }
        for (let field of this.fields) {
            if (!field.opt && !seen.has(field.name)) {
                throw new Error(`Required field '${field.name}' on ` +
                                `kind ${type} is not present`);
            }
        }
        for (let branch of this.branches) {
            if (!branch.opt && !seen.has(branch.name)) {
                throw new Error(`Required branch '${branch.name}' on ` +
                                `kind ${type} is not present`);
            }
        }
    }
}
function makeNodeType(name, short_name, fields_str, branches_str) {
    const fields = FieldInfo.parseNameList(fields_str);
    const branches = FieldInfo.parseNameList(branches_str);
    return new NodeType({name, short_name, fields, branches});
}

class ParentEdge {
    constructor() {
        this.node = null;
        this.name = '';
        this.display_name = '';
    }
    setFinal(node, name, display_name) {
        this.node = node;
        this.name = name;
        this.display_name = display_name;
        Object.freeze(this);
    }
}

class BaseNode {
    constructor(type, node_obj, attrs=null) {
        if (!attrs) { attrs = {}; }

        assert(type !== undefined, "Undefined type for Node constructor.");
        this.type = type;
        this.node_obj = node_obj;
        this.parent_edge = new ParentEdge();

        for (let df of type.del_fields) {
            delete node_obj[df.name];
        }
        for (let db of type.del_branches) {
            delete node_obj[db.name];
        }

        this.lifted_fields = new Map();
        type.eachLiftedFieldInObj(node_obj, (name, field) => {
            this.lifted_fields.set(name, field);
        });
        Object.freeze(this.lifted_fields);

        this.lifted_children = new Map();
        type.eachLiftedChildInObj(node_obj, (name, child) => {
            this.lifted_children.set(name, child);
            if (Array.isArray(child)) {
                child.forEach((ch, i) => {
                    const display_name = name + '.' + i;
                    ch.parent_edge.setFinal(this, name, display_name);
                });
            } else if (child) {
                child.parent_edge.setFinal(this, name, name);
            }
        });
        Object.freeze(this.lifted_children);

        this.attrs = attrs;
        Object.freeze(this);
        this.verify();
    }

    depthFirstNumber() {
        this.depthFirstNumberFrom_(0, 0);
    }
    depthFirstNumberFrom_(num, depth) {
        this.attrs.number = num;
        this.attrs.depth = depth;
        let n = num + 1;
        this.forEachChild((child, name) => {
            if (Array.isArray(child)) {
                for (let ch of child) {
                    n = ch.depthFirstNumberFrom_(n, depth+1);
                }
            } else if (child) {
                n = child.depthFirstNumberFrom_(n, depth+1);
            }
        });
        return n;
    }

    parentNode() {
        return this.parent_edge.node;
    }

    typeString() {
        return this.node_obj.type;
    }

    verify() {
        this.type.verifyNode(this);
    }

    numFields() {
        return this.lifted_fields.size;
    }
    numChildren() {
        return this.lifted_children.size;
    }
    fieldMap() {
        const result = new Map();
        this.forEachField((field, name) => result.set(name, field));
        return result;
    }
    childMap() {
        const result = new Map();
        this.forEachChild((child, name) => result.set(name, child));
        return result;
    }
    forEachField(cb) {
        this.lifted_fields.forEach(cb);
    }
    forEachChild(cb) {
        this.lifted_children.forEach(cb);
    }

    summaryString() {
        let str = `${this.type.name}`;
        if (Number.isInteger(this.attrs.number)) {
            str += ` [${this.attrs.number}]/D${this.attrs.depth}`;
        }
        if (this.node_obj.loc) {
            const loc= this.node_obj.loc;
            const start_pos = `${loc.start.line}+${loc.start.column}`;
            const end_pos = `${loc.end.line}+${loc.end.column}`;
            str += ` Loc(${start_pos} to ${end_pos})`;
        }
        return str;
    }

    toString() {
        const accum = [];
        accum.push(this.type.short_name);
        accum.push("[");
        let first = true;
        for (let field of this.type.fields) {
            if (first) { first = false; }
            else       { accum.push(", "); }

            const field_obj = this.lifted_fields.get(field.name);
            if (field_obj) {
                accum.push(field.name);
                accum.push("=");
                accum.push(field_obj.valueString());
            } else if (!field.opt) {
                throw new Error(`Required field ${field.name}` +
                    ` not found on obj ${jsonStr(this.node_obj)}`);
            }
        }
        accum.push("]");
        accum.push("{");
        first = true;
        for (let branch of this.type.branches) {
            if (first) { first = false; }
            else       { accum.push("; "); }
            const child = this.lifted_children.get(branch.name);
            if (child) {
                accum.push(branch.name);
                accum.push(": ");
                accum.push(child.toString());
            } else if (!branch.opt) {
                throw new Error(`Required child ${branch.name}` +
                    ` not found on obj ${jsonStr(this.node_obj)}`);
            } else if (branch.array) {
                accum.push(branch.name);
                accum.push(": []");
            }
        }
        accum.push("}");
        return accum.join('');
    }

    static subclassFor(type) {
        if (!BaseNode._subclasses) {
            BaseNode._subclasses = {};
        }
        let cls = BaseNode._subclasses[type.name];
        if (cls) { return cls; }

        cls = BaseNode._makeSubclassFor(type);
        BaseNode._subclasses[type.name] = cls;
        return cls;
    }
    static _makeEmptySubclass(type) {
        class C extends BaseNode {
            constructor(...args) {
                super(type, ...args);
            }
        };
        Object.defineProperty(C, 'name', {
            value: type.name,
            writable: false,
            enumerable: false,
            configurable: true,
        });
        return C;
    }
    static _makeSubclassFor(type) {
        assert(!BaseNode._subclasses ||
               !BaseNode._subclasses[type.name]);

        const cls = BaseNode._makeEmptySubclass(type);

        // Define getter methods for fields.
        for (let field of type.fields) {
            cls.prototype[field.name] = function () {
                return this.lifted_fields.get(field.name);
            }
        }

        // Define getter methods for children.
        for (let branch of type.branches) {
            if (branch.array) {
                cls.prototype.field = function (...args) {
                    const lc = this.lifted_children.get(field.name);
                    return (args.length > 0) ? lc[args[0]] : lc;
                };
            } else {
                cls.prototype[branch.name] = function () {
                    return this.lifted_children.get(branch.name);
                };
            }
        }

        return cls;
    }
}

class Unknown extends BaseNode {
    constructor(node_obj, info) {
        super(NodeType.T.Unknown, node_obj, info);
     }

    nodeObj() { return this.node_obj; }

    toString() { return `Unknown(${jsonStr(this.node_obj)})`; }
}

(function () {
    const node_type_list = [
        makeNodeType('Identifier',          'Id',         'name',             ''),
        makeNodeType('Literal',             'Lit',        'value,-raw,?regex', ''),
        makeNodeType('CallExpression',      'CallExpr',   '',                 'callee,*arguments'),
        makeNodeType('NewExpression',       'NewExpr',    '',                 'callee,*arguments'),
        makeNodeType('VariableDeclarator',  'VarItem',    '',                 'id,?init'),
        makeNodeType('VariableDeclaration', 'Var',        'kind',             '*declarations'),
        makeNodeType('MemberExpression',    'Member',     'computed',         'property,object'),
        makeNodeType('ArrayExpression',     'Array',      '',                 '*elements'),

        makeNodeType('Property',            'Prop',       'computed,kind,method,shorthand',
                                                          'key,value'),

        makeNodeType('ExpressionStatement', 'ExprStmt',   '?directive',                 'expression'),
        makeNodeType('BlockStatement',      'BlockStmt  ','',                 '*body'),

        makeNodeType('FunctionExpression',  'FuncExpr',   'generator,expression,async',
                                                          '?id,*params,body'),

        makeNodeType('FunctionDeclaration', 'FuncDecl',   'generator,expression,async',
                                                          'id,*params,body'),

        makeNodeType('BinaryExpression',    'BinExpr',    'operator',         'left,right'),
        makeNodeType('UnaryExpression',     'UnyExpr',    'operator,prefix',  'argument'),
        makeNodeType('AssignmentExpression','AssignExpr', 'operator',         'left,right'),

        makeNodeType('ConditionalExpression','CondExpr',  '',
                                                          'test,consequent,alternate'),

        makeNodeType('IfStatement',         'IfStmt',     '',
                                                          'test,consequent,?alternate'),

        makeNodeType('SequenceExpression',  'SeqExpr',    '',                 '*expressions'),
        makeNodeType('ThisExpression',      'ThisExpr',   '',                 ''),

        makeNodeType('TryStatement',        'TryStmt',    '',
                                                          'block,handler,?finalizer'),
        makeNodeType('CatchClause',         'Catch',      '',                 'param,body'),
        makeNodeType('ForStatement',        'ForStmt',    '',
                                                          '?init,test,?update,body'),
        makeNodeType('ForInStatement',      'ForInStmt',  'each',             'left,right,body'),
        makeNodeType('WhileStatement',      'WhileStmt',  '',                 'test,body'),
        makeNodeType('DoWhileStatement',    'DoWhileStmt','',                 'body,test'),
        makeNodeType('UpdateExpression',    'Update',     'operator,prefix',  'argument'),
        makeNodeType('BreakStatement',      'Break',      '?label',           ''),
        makeNodeType('ContinueStatement',   'Continue',   '?label',           ''),
        makeNodeType('EmptyStatement',      'Empty',      '',                 ''),
        makeNodeType('ThrowStatement',      'Throw',      '',                 'argument'),
        makeNodeType('SwitchStatement',     'Switch',     '',                 'discriminant,*cases'),
        makeNodeType('SwitchCase',          'Case',       '',                 'test,*consequent'),

        makeNodeType('LogicalExpression',   'LogicExpr',  'operator',         'left,right'),
        makeNodeType('ReturnStatement',     'RetStmt',    '',                 '?argument'),
        makeNodeType('ObjectExpression',    'ObjExpr',    '',                 '*properties'),
        makeNodeType('Program',             'Program',    'sourceType',       '*body'),
        makeNodeType('Unknown',             'Unknown',    '',                 ''),
    ];

    const node_type_map = {};
    const node_type_classes = {};
    const node_type_names = {};
    for (let nt of node_type_list) {
        node_type_map[nt.name] = nt;
        node_type_classes[nt.name] = nt.gen_cls;
        node_type_names[nt.name] = nt.name;
    }
    NodeType.T = node_type_map;
    NodeType.C = node_type_classes;
    NodeType.N = node_type_names;
})();

module.exports = {
    NodeType
};
