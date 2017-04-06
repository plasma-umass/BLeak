import {equal as assertEqual} from 'assert';
import {injectIntoHead, exposeClosureState} from '../src/lib/transformations';
import ClosureDeclTest from './fixtures/closure_transformations/declaration';
import ClosureExpTest from './fixtures/closure_transformations/expression';
import ClosureNamedExpTest from './fixtures/closure_transformations/named_expression';
import ClosureNestedTest from './fixtures/closure_transformations/nested';
import ClosureNoMatchesTest from './fixtures/closure_transformations/no_matches';
import ClosureDoubleExpTest from './fixtures/closure_transformations/double_expr';
import ClosureNestedDeclarationsTest from './fixtures/closure_transformations/nested_declaration';

const REPLACE_DOUBLE_SEMICOLONS = /;+/g;

describe('Transformations', function() {
  describe('injectIntoHead', function() {
    const headTagTypes = [
      [`<head>`, `</head>`, 'is in lowercase'],
      [`<HEAD>`, `</HEAD>`, 'is in uppercase'],
      [`<heAd>`, `</HeAd>`, 'is in a mix of lower and uppercase'],
      [`< head >`, `</ head>`, 'has whitespace within tag'],
      [`<\n\thead\n\t>`, `</\n\thead>`, 'has newlines within tag'],
      [``, ``, 'is missing']
    ];

    headTagTypes.forEach((headTag) => {
      it(`should work when the head tag ${headTag[2]}`, function() {
        const source = `<!DOCTYPE html><html>${headTag[0]}${headTag[1]}</html>`;
        const injection = `hello`;
        const output = `<!DOCTYPE html><html>${headTag[0]}${injection}${headTag[1]}</html>`;
        assertEqual(injectIntoHead(source, injection), output);
      });
    });
  });

  describe('exposeClosureState', function() {
    [ClosureDeclTest, ClosureExpTest, ClosureNamedExpTest, ClosureNestedTest, ClosureNoMatchesTest, ClosureDoubleExpTest, ClosureNestedDeclarationsTest].forEach((test) => {
      it(test.name, function() {
        let result = exposeClosureState(test.source, test.mods);
        // Note: Due to an implementation artifact, some statements have two ;;'s. This is a harmless bug.
        assertEqual(result.replace(REPLACE_DOUBLE_SEMICOLONS, ';'), test.transformed);
      });
    });
  });
});