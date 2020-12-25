const input = rawValue => {
  if(rawValue == null) return Promise.reject(new Error('Please input a value'));
  const value = Number.parseInt(rawValue, 10);  // 必ず数値にする・変換できない場合は NaN になる
  if(Number.isNaN(value)) return Promise.reject(new Error('Input value is not a number'));
  if(value < 0 || value > 100) return Promise.reject(new Error('Expected a number between 0 and 100'));
  return Promise.resolve(value.toFixed(0));  // 整数の文字列にする
};

if(process.platform === 'darwin') {
  const childProcess = require('child_process');
  const promisify = require('util').promisify;
  
  const execFile = promisify(childProcess.execFile);
  const getBrightness = stdout => {
    const brightnessResult = (/"brightness"={(.*?)}/).exec(stdout);  // `"brightness"={"max"=1024,"min"=0,"value"=806}` のような値が取れる
    if(!brightnessResult) return Promise.reject(new Error('This display is not supported'));
    const brightnessJSON = `{${brightnessResult[1].replace((/=/g), ':')}}`;  // `=` を `:` に変えて JSON 文字列として解釈できるようにする
    const brightness = JSON.parse(brightnessJSON);
    return Promise.resolve(brightness.value / brightness.max);
  };
  
  module.exports.get = () => {
    const cmd = 'ioreg';
    const args = ['-c', 'AppleBacklightDisplay', '-r', '-d', 1];
    return execFile(cmd, args).then(firstResult => {
      if(firstResult.stdout) return getBrightness(firstResult.stdout);
      args[1] = 'AppleDisplay';
      return execFile(cmd, args).then(secondResult => {
        if(!secondResult.stdout) return Promise.reject(new Error('This display is not supported'));
        return getBrightness(secondResult.stdout);
      });
    });
  };
  
  module.exports.set = rawValue => input(rawValue).then(value => execFile('./brightness-darwin', [value], { cwd: __dirname }));
}
else if(process.platform === 'linux') {
  const fs = require('fs').promises;
  const path = require('path');
  
  const dir = '/sys/class/backlight';
  const getBrightness = device => fs.readFile(path.join(dir, device, 'brightness'), 'utf8');
  const getMaxBrightness = device => fs.readFile(path.join(dir, device, 'max_brightness'), 'utf8');
  const setBrightness = (device, value) => fs.writeFile(path.join(dir, device, 'brightness'), value);
  const getBacklight = () => fs.readdir(dir).then(dirs => {
    if(!dirs.length) throw new Error('No backlight device found');
    return dirs[0];
  });
  
  module.exports.get = () => getBacklight()
    .then(device => Promise.all([getMaxBrightness(device), getBrightness(device)]))
    .then(results => Number(results[1]) / Number(results[0]));
  
  module.exports.set = value => {
    if(typeof value !== 'number' || value < 0 || value > 1) return Promise.reject(new Error('Expected a number between 0 and 1'));
    return getBacklight()
      .then(device => Promise.all([getMaxBrightness(device), device]))
      .then(results => {
        const max = Number(results[0]);
        const brightness = Math.floor(value * max).toString();
        return setBrightness(results[1], brightness);
      })
      .catch(error => {
        if(error.code === 'EACCES') {
          error.message = 'You do not seem to have permission to change the brightness. Try running this command with `sudo`.';
        }
        throw error;
      });
  };
}
else if(process.platform === 'win32') {
  const nircmd = require('nircmd');
  const wmiClient = require('wmi-client');
  
  module.exports.get = () => new Promise((resolve, reject) => {
    const wmi = new wmiClient({
      host: 'localhost',
      namespace: '\\\\root\\WMI'
    });
    wmi.query('SELECT CurrentBrightness, InstanceName FROM WmiMonitorBrightness', (error, results) => {
      if(error) return reject(error);
      if(!results.length) return reject(new Error('Unable to find any monitors to read brightness levels from'));
      resolve(results[0].CurrentBrightness);
    });
  });
  
  module.exports.set = rawValue => input(rawValue).then(value => nircmd(['setbrightness', value]));
}
else {
  throw new Error('Unsupported platform');
}
