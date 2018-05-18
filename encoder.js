
const assert = require('assert');

const tree_top = require('./tree_top');

/**
 * The encoder encodes as follows:
 *
 *  - Stage 1: all strings are collected and ordered by frequency
 *    of use, assigned id by order (0 = highest frequency).
 *      * Collect field names, child names, raw strings in tree.
 *  - Stage 2: all for every node, assign it a type constructed
 *    from the set `{ node } U FieldNames(node) U ChildNames(node)`
 *  - Stage 3: Start encoding.
 *
 *      EncNode(node):
 *          EncVarUint(node_id(type_id(node)))
 *
 *          for fn in FieldNames(node):
 *              EncVarUint(StringId(fn))
 *              EncValue(GetField(node, fn))
 *
 *          for cn in ChildNames(node):
 *              EncVarUint(StringId(cn))
 *              let child = GetChild(node, cn)
 *
 *              if IsArray(child):
 *                  EncVarUint(Length(child))
 *                  for c in child:
 *                      EncNode(c)
 *              else:
 *                  EncNode(c)
 *
 *      EncTreeRef(rel_depth, rev_idx, cut_list):
 *          EncVarUint(SubtreeRef(rel_depth, rev_idx))
 *          EncU8(cut_list.length)
 *          for cut in cut_list:
 *              EncU8(cut)
 *
 *      EncValue(value):
 *          if IsNull(value):
 *              EncU8(NullCode)
 *          if IsBool(value):
 *              EncU8(BoolCode(value))
 *          if IsInt(value):
 *              EncU8(IntCode(value))
 *
 * A subtree can be encoded directly or by referring to either
 * a prior subtree or a prior template.  When beginning a subtree
 * parse, the first varuint number identifies the variant in effect.
 *
 * Node types are simply encoded directly.  Node type 0 is reserved
 * for tree-references, and node type 1 is reserved for template
 * references.  These node types indicate subsequent bytes
 * that specify the subtree or template reference data.
 *
 * JS value encodings:
 *      End:                0000-0000
 *      Null:               0000-0001
 *      False:              0000-0010
 *      True:               0000-0011
 *      Int[-1 to 11]       0000-0100 to 0000-1111
 *      Int                 0001-00SS <B> <B> ... <B>
 *      Str                 0001-01SS <B> <B> ... <B>
 *      Array[len>=8]       0010-00SS ...
 *      Array[len<8]        0010-1SSS ...
 */

const PRIOR_TREE_CODE = 0;
const PRIOR_TEMPLATE_CODE = 1;
const RAW_IDENT_TYPE_CODE = 2;
const FIRST_NODE_TYPE_CODE = 3;

const NULL_CODE = 0;
const FALSE_CODE = 1;
const TRUE_CODE = 2;

const NANO_INT_MIN_CODE = 4;
const NANO_INT_MAX_CODE = 15;
const NANO_INT_RANGE = (NANO_INT_MAX_CODE - NANO_INT_MIN_CODE) + 1;

const NANO_INT_MIN = -1;
const NANO_INT_MAX = NANO_INT_MIN + (NANO_INT_RANGE - 1);

const INT_TAG = 0x10;
const STR_TAG = 0x14;

const NANO_ARR_TAG = 0x20;
const NANO_ARR_MAX_LENGTH = 7;

const ARR_TAG = 0x28;

function isNanoInt(i) {
    return Number.isInteger(i) && (i >= NANO_INT_MIN) && (i <= NANO_INT_MAX);
}
function nanoIntCode(i) {
    assert(isNanoInt(i));
    return (i - NANO_INT_MIN) + NANO_INT_MIN_CODE;
}

class StringTable {
    constructor() {
        this.use_counts = new Map();
        this.sorted_arr = [];
        this.idx_map = new Map();
    }

    numStrings() {
        return this.sorted_arr.length;
    }

    addString(s) {
        this.use_counts.set(s, (this.use_counts.get(s) || 0) + 1);
    }

    addValueRecursive(v) {
        if (typeof(v) == 'string') {
            this.addString(v);
        } else if (typeof(v) == 'object' && v !== null) {
            Object.getOwnPropertyNames(v).forEach(n => {
                this.addValueRecursive(v[n]);
            });
        }
    }

    addIdentifier(nm) {
        assert(typeof(nm) == 'string');
        assert(nm.length > 0);
        if (nm.length > 1) {
            this.addString(nm);
        }
    }


    lookup(s) {
        assert(this.idx_map.has(s), "Looking up string: `" + s + "`");
        return this.idx_map.get(s);
    }

    forEachString(cb) {
        for (let i = 0; i < this.sorted_arr.length; i++) {
            cb(this.sorted_arr[i]);
        }
    }

    finish() {
        this.sorted_arr = [];
        this.use_counts.forEach((count, s) => this.sorted_arr.push(s));
        this.sorted_arr.sort((a, b) => {
            return this.use_counts.get(b) - this.use_counts.get(a);
        });
        for (let i = 0; i < this.sorted_arr.length; i++) {
            this.idx_map.set(this.sorted_arr[i], i);
        }
    }
}

function hexByte(b) {
    const s = b.toString(16);
    return (s.length < 2) ? "0" + s : s;
}

class Encoder {
    constructor() {
        this.string_table = null;
        this.bytes = [];
    }

    writeU8(v) {
        this.bytes.push((v >>> 0) & 0xFF);
    }
    writeVarUint(v) {
        // Only handle 32-bit values for now.
        assert(v <= 0xFFFFFFFF);
        while (v > 0x7F) {
            this.writeU8((v & 0x7F) | 0x80);
            v >>= 7;
        };
        this.writeU8(v);
    }

    writeStringTable(st) {
        this.string_table = st;
        this.writeVarUint(st.numStrings());
        st.forEachString(s => {
            this.writeVarUint(s.length);
            for (let c of s) {
                this.writeU8(c.charCodeAt(0) & 0xFF);
            }
        });
    }

    // Encode a node directly, call callback for
    // encoding of any child subtrees.
    writeDirectNode(node) {
        if (node.type.name == 'Identifier') {
            const idname = node.getField('name').value;
            assert(idname.charCodeAt(0) < 128);
            if (idname.length == 1) {
                this.writeVarUint(RAW_IDENT_TYPE_CODE);
                this.writeU8(idname.charCodeAt(0) & 0xFF);
            } else {
                this.writeVarUint(node.type.typeCode());
                this.writeValue(idname);
            }
            return;
        }

        // Write the node's type code.
        this.writeVarUint(node.type.typeCode());

        // For every field in order, write out the field.
        node.forEachField((field, name) => {
            this.writeValue(field.value);
        });
    }

    // Encode a reference to prior tee and a series of
    // cutpoints, call callback for encoding any substitute
    // child trees.
    writeSubtreeRef(rel_depth, rev_index, cuts) {
        assert(rel_depth >= -63 && rel_depth <= 63, "rel_depth=" + rel_depth);
        assert(rev_index <= 255, "rev_index=" + rev_index);
        this.writeVarUint(PRIOR_TREE_CODE);
        this.writeU8(rel_depth);
        this.writeU8(rev_index);
        for (let cut of cuts) {
            this.writeU8(cut);
        }
        this.writeU8(0xFF);
    }

    // Encode a reference to prior tee and a series of
    // cutpoints, call callback for encoding any substitute
    // child trees.
    writeTemplateRef(rel_depth, rev_index) {
        assert(rel_depth >= -63 && rel_depth <= 63, "rel_depth=" + rel_depth);
        assert(rev_index <= 255, "rev_index=" + rev_index);
        this.writeVarUint(PRIOR_TEMPLATE_CODE);
        this.writeU8(rel_depth);
        this.writeU8(rev_index);
    }

    // Encode a raw value.
    writeValue(val) {
        if (val === null) {
            this.writeU8(NULL_CODE);
        } else if (val === false) {
            this.writeU8(FALSE_CODE);
        } else if (val === true) {
            this.writeU8(TRUE_CODE);
        } else if (isNanoInt(val)) {
            this.writeU8(nanoIntCode(val));
        } else if (Number.isInteger(val)) {
            this.writeTaggedNum(INT_TAG, val);
        } else if (typeof(val) == 'string') {
            this.writeTaggedNum(STR_TAG, this.string_table.lookup(val));
        } else if (Array.isArray(val)) {
            if (val.length < NANO_ARR_MAX_LENGTH) {
                this.writeU8(NANO_ARR_TAG | val.length);
            } else {
                this.writeTaggedNum(ARR_TAG, val.length);
            }
            for (var i = 0; i < val.length; i++) {
                this.writeValue(val[i]);
            }
        } else {
            assert("Only null, bool, and int values handled.");
        }
    }

    writeTaggedNum(tag, num) {
        assert(num >= (-1 << 31))
        assert(num <= (-1 >>> 1))
        let uv = num >>> 0;
        if ((num >>> 0) <= 0xFF) {
            this.writeU8(INT_TAG | 0);
            this.writeU8(num);
        } else if ((num >>> 0) <= 0xFFFF) {
            this.writeU8(INT_TAG | 1);
            this.writeU8(num & 0xFF);
            this.writeU8((num >> 8) & 0xFF);
        } else if ((num >>> 0) <= 0xFFFFFF) {
            this.writeU8(INT_TAG | 2);
            this.writeU8(num & 0xFF);
            this.writeU8((num >> 8) & 0xFF);
            this.writeU8((num >> 16) & 0xFF);
        } else {
            assert((num >>> 0) < (-1 >>> 0));
            this.writeU8(INT_TAG | 3);
            this.writeU8(num & 0xFF);
            this.writeU8((num >> 8) & 0xFF);
            this.writeU8((num >> 16) & 0xFF);
            this.writeU8((num >> 24) & 0xFF);
        }
    }

    dump() {
        for (let i = 0; i < this.bytes.length; i += 16) {
            console.log("" + i + ": " + this.bytes.slice(i, i + 16).map(b => hexByte(b)).join('  '));
        }
    }

    byteArray() {
        return new Buffer(this.bytes);
    }
}

module.exports = {FIRST_NODE_TYPE_CODE, Encoder, StringTable};
