
"use strict";

const fs = require('fs');
const process = require('process');
const esprima = require('esprima');

const compressor = require('./compressor');

function errExit(msg, ...args) {
    let buf = [msg];
    if (args.length > 0) {
        buf.push(": ");
    }
    for (let arg of args) {
        buf.push("" + arg);
        buf.push(", ");
    }
    console.error(buf.join(""));
    process.exit();
}

function parseArgs(args) {
    const opts = {tokens: false, ast: false, lifted: false,
                  type_sorted: false, compress: false};
    args = args.filter(arg => {
        switch (arg) {
          case '--tokens': opts.tokens = true; break;
          case '--no-tokens': opts.tokens = false; break;
          case '--ast': opts.ast = true; break;
          case '--no-ast': opts.ast = false; break;
          case '--lifted': opts.lifted = true; break;
          case '--no-lifted': opts.lifted = false; break;
          case '--type-sorted': opts.type_sorted = true; break;
          case '--no-type-sorted': opts.type_sorted = false; break;
          case '--compress': opts.compress = true; break;
          case '--no-compress': opts.compress = false; break;
          default:
            return true;
        }
        return false;
    });
    return [args, opts];
}

function processJs(js_str, opts) {
    let did_something = false;

    if (opts.tokens) {
        dumpTokens(js_str, opts);
        did_something = true;
    }
    if (opts.ast) {
        dumpAst(js_str, opts);
        did_something = true;
    }
    if (opts.lifted) {
        dumpLiftedAst(js_str, opts);
        did_something = true;
    }
    if (opts.type_sorted) {
        dumpTypeSortedAst(js_str, opts);
        did_something = true;
    }
    if (opts.compress) {
        dumpCompress(js_str, opts);
        did_something = true;
    }

    if (!did_something) {
        err_exit("Specify one of --tokens, --ast, --lifted or --compress");
    }
}

function dumpTokens(js_str, opts) {
    console.log("######################");
    console.log("#####        #########");
    console.log("##### Tokens #########");
    console.log("#####        #########");
    console.log("######################");
    console.log("");
    const tokens = esprima.tokenize(js_str);
    tokens.forEach((token, i) => {
        const {type, value} = token;
        console.log("Token(" + i + "): " + type + " => " + value);
    });
}

function dumpAst(js_str, opts) {
    console.log("######################");
    console.log("#####     ############");
    console.log("##### AST ############");
    console.log("#####     ############");
    console.log("######################");
    console.log("");
    const ast = esprima.parseScript(js_str);
    console.log(JSON.stringify(ast, "utf8", 2));
}

function dumpLiftedAst(js_str, opts) {
    console.log("######################");
    console.log("#####        #########");
    console.log("##### LIFTED #########");
    console.log("#####        #########");
    console.log("######################");
    console.log("");
    compressor.dump_lifted(js_str);
}

function dumpTypeSortedAst(js_str, opts) {
    console.log("######################");
    console.log("#####             ####");
    console.log("##### TYPE SORTED ####");
    console.log("#####             ####");
    console.log("######################");
    console.log("");
    compressor.dump_type_sorted(js_str);
}

function dumpCompress(js_str, opts) {
    console.log("######################");
    console.log("#####          #######");
    console.log("##### Compress #######");
    console.log("#####          #######");
    console.log("######################");
    console.log("");
    compressor.compress(js_str);
}

function main() {
    const [args, opts] = parseArgs(process.argv.slice(2));
    if (args.length < 1) {
        errExit("Did not get file arguments.");
    }
    
    fs.readFile(args[0], 'utf8', (err, js_str) => {
        if (err) {
            errExit("Unable to open file", args[0], err);
        }
        processJs(js_str, opts);
    });
}

main();
