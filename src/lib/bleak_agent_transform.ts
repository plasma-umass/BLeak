// Portion of the bleak agent that should be transformed to capture scope information.
// TODO: Can add Maps and Sets here.

/**
 * Override bind so that we properly capture __scope__ here.
 */
function aFunction(it: Function): Function {
  if (typeof it !== 'function') {
    throw TypeError(it + ' is not a function!');
  }
  return it;
}

function isObject(it: any): it is object {
  return it !== null && (typeof it == 'object' || typeof it == 'function');
}

const _slice = [].slice;
const factories: {[len: number]: Function} = {};

function construct(F: Function, len: number, args: any[]) {
  if(!(len in factories)){
    for(var n = [], i = 0; i < len; i++)n[i] = 'a[' + i + ']';
    factories[len] = Function('F,a', 'return new F(' + n.join(',') + ')');
  }
  return factories[len](F, args);
}

function invoke(fn: Function, args: any[], that: any){
  return fn.apply(that, args);
}

Function.prototype.bind = function bind(this: Function, that: any, ...partArgs: any[]): Function {
  const fn       = aFunction(this);
  const bound = function(this: any, ...restArgs: any[]){
    const args = partArgs.concat(restArgs);
    return this instanceof bound ? construct(fn, args.length, args) : invoke(fn, args, that);
  };
  if (isObject(fn.prototype)) {
    bound.prototype = fn.prototype;
  }
  return bound;
};