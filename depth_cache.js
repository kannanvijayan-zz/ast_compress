
"use strict";

const assert = require('assert');
const {ComputeTemplate, Template} = require('./tree_top');

/**
 * A depth-cache caches subtrees
 * and templates at different depths.
 *
 * The cache at each depth is WIDTH
 * entries wide, and there is one
 * for subtrees and one for templates.
 */

class DepthCache {
    constructor() {
        this.width = 64;
        this.depth_range = 2;
        this.depth_caches = [];
        Object.freeze(this);
    }

    getEntry_(depth) {
        while (this.depth_caches.length <= depth) {
            this.depth_caches.push({trees:[], templates:[]});
        }
        return this.depth_caches[depth];
    }

    search(depth, tree) {
        const template_result = this.templateSearch_(depth, tree);
        const tree_result = this.treeSearch_(depth, tree);
        if (template_result.ref && tree_result.ref) {
            if (template_result.benefit >= tree_result.benefit) {
                return template_result;
            } else {
                return tree_result;
            }
        } else if (template_result.ref) {
            return template_result;
        } else if (tree_result.ref) {
            return tree_result;
        } else {
            return {};
        }
    }

    templateSearch_(depth, tree) {
        // Search depth, depth-1, depth+1 in that order.
        const matches = [];

        this.templateSearchDepth_(depth, tree, 0, matches);
        for (let i = 1; i <= this.depth_range; i++) {
            this.templateSearchDepth_(depth, tree, -i, matches);
            this.templateSearchDepth_(depth, tree, i, matches);
        }

        matches.sort((a, b) => (b.benefit - a.benefit));
        if (matches.length > 0 && matches[0].benefit > 0) {
            return matches[0];
        }
        return {};
    }
    templateSearchDepth_(cur_depth, tree, depth_delta, matches) {
        const depth = cur_depth + depth_delta;
        if (depth < 0) {
            return;
        }
        if (depth >= this.depth_caches.length) {
            return;
        }

        const cache = this.depth_caches[depth].templates;
        for (let rev_i = 0; rev_i < cache.length; rev_i++) {
            const i = cache.length - (rev_i + 1);
            const prior_template = cache[i];
            const cuts = prior_template.matchesTree(tree);
            if (Array.isArray(cuts)) {
                const benefit = prior_template.benefit;
                let depth_str;
                if (depth_delta == 0) {
                    depth_str = `${cur_depth}=TMPL.0`;
                } else if (depth_delta > 0) {
                    depth_str = `${cur_depth}=TMPL.+${depth_delta}`;
                } else {
                    depth_str = `${cur_depth}=TMPL.-${-depth_delta}`;
                }
                matches.push({ref:`${depth_str}.${rev_i}`,
                              depth_delta, rev_i,
                              benefit: prior_template.benefit,
                              prior_template, cuts});
            }
        }
    }
    treeSearch_(depth, tree) {
        // Search depth, depth-1, depth+1 in that order.
        const matches = [];

        this.treeSearchDepth_(depth, tree, 0, matches);
        if (depth - 1 >= 0) {
            this.treeSearchDepth_(depth, tree, -1, matches);
        }
        this.treeSearchDepth_(depth, tree, 1, matches);

        matches.sort((a, b) => (b.benefit - a.benefit));
        if (matches.length > 0 && matches[0].benefit > 0) {
            return matches[0];
        }
        return {};
    }
    treeSearchDepth_(cur_depth, tree, depth_delta, matches) {
        const depth = cur_depth + depth_delta;
        if (depth < 0) {
            return;
        }
        if (depth >= this.depth_caches.length) {
            return;
        }

        // console.log("KVKV "+`searchDepth_(${depth},${tree.type.name})`);
        const cache = this.depth_caches[depth].trees;
        for (let rev_i = 0; rev_i < cache.length; rev_i++) {
            const i = cache.length - (rev_i + 1);
            const prior_tree = cache[i];
            const is_match = (tree.type === prior_tree.type);
            if (is_match) {
                const ct = new ComputeTemplate(prior_tree, tree);
                const template = ct.compute();
                const {step_count, cut_count, cuts} = template;
                // Cost of 1 to encode reference to subtree.
                // Cost of 1 per cut_count.
                // Benefit of 1 per step_count.
                const benefit = (step_count - cut_count) - 1;
                let depth_str;
                if (depth_delta == 0) {
                    depth_str = `${cur_depth}=0`;
                } else if (depth_delta > 0) {
                    depth_str = `${cur_depth}=+${depth_delta}`;
                } else {
                    depth_str = `${cur_depth}=-${-depth_delta}`;
                }
                matches.push({ref:`${depth_str}.${rev_i}`, prior_tree,
                              depth_delta, rev_i,
                              benefit, step_count, cut_count, cuts,
                              template});
            }
        }
    }
    

    pushTree(depth, tree) {
        console.log("KVKV: "+`pushing tree ${tree.attrs.number} - ${tree.type.name}`);
        this.cachePush(this.getEntry_(depth).trees, tree);
    }

    pushTemplate(depth, template) {
        console.log("KVKV: "+`pushing template for tree ${template.tree.attrs.number} - ${template.tree.type.name}`);
        this.cachePush(this.getEntry_(depth).templates, template);
    }

    cachePush(cache, item) {
        cache.push(item);
        while (cache.length >= this.width) {
            cache.shift();
        }
    }
}

module.exports = { DepthCache };
