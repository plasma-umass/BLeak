import sourcemaps from 'rollup-plugin-sourcemaps';
import buble from 'rollup-plugin-buble';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import replace from 'rollup-plugin-replace';
// import builtins from 'rollup-plugin-node-builtins';
// import globals from 'rollup-plugin-node-globals';
import {join} from 'path';

const inBase = join(__dirname, 'build', 'browser', 'src');
const outBase = join(__dirname, 'build', 'browser');

export default {
  input: join(inBase, 'viewer', 'index.js'),
  output: [{
    file: join(outBase, 'viewer.js'),
    sourcemap: true,
    strict: true,
    globals: {
      d3: 'd3',
      jquery: '$'
    },
    format: 'iife',
    name: 'BLeakResultsViewer'
  }],
  external: ['d3', 'jquery'],
  plugins: [
    sourcemaps(),
    buble({
      transforms: {
        // Assumes all `for of` statements are on arrays or array-like items.
        dangerousForOf: true
      }
    }),
    resolve({
      // use "module" field for ES6 module if possible
      module: true, // Default: true

      // use "jsnext:main" if possible
      // – see https://github.com/rollup/rollup/wiki/jsnext:main
      jsnext: true,  // Default: false

      // use "main" field or index.js, even if it's not an ES6 module
      // (needs to be converted from CommonJS to ES6
      // – see https://github.com/rollup/rollup-plugin-commonjs
      main: true,  // Default: true

      // some package.json files have a `browser` field which
      // specifies alternative files to load for people bundling
      // for the browser. If that's you, use this option, otherwise
      // pkg.browser will be ignored
      browser: true  // Default: false
    }),
    commonjs({
      namedExports: {
        //'vis': ['Network', 'DataSet'],
        'react-dom': ['render'],
        'react': ['Component', 'createElement'],
        'brace': ['acequire']
      }
    }),
    replace({
      // Production for production builds.
      'process.env.NODE_ENV': JSON.stringify( 'development' )
    })
    // builtins(),
    // globals()
  ]
};