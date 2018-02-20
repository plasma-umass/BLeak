import sourcemaps from 'rollup-plugin-sourcemaps';
import buble from 'rollup-plugin-buble';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import replace from 'rollup-plugin-replace';
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
      module: true,
      jsnext: true,
      main: true,
      browser: true
    }),
    commonjs({
      namedExports: {
        'react-dom': ['render'],
        'react': ['Component', 'createElement'],
        'brace': ['acequire']
      }
    }),
    replace({
      // Production for production builds.
      'process.env.NODE_ENV': JSON.stringify( 'development' )
    })
  ]
};
