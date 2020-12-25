#!/usr/bin/env node

const brightness = require('../lib/index');

const exec = (methodName, value) => brightness[methodName](value)
  .then(result => console.log(result))
  .catch(error => console.error(error));

switch(process.argv[2]) {
  case 'get':
    return exec('get');
  case 'set':
    return exec('set', process.argv[3]);
  default:
    return console.error('Brightness : Please input a valid sub command');
}
