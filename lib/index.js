const input = rawValue => {
  if(rawValue == null) return Promise.reject(new Error('Please input a value'));
  const value = Number.parseInt(rawValue, 10);  // 必ず数値にする・変換できない場合は NaN になる
  if(Number.isNaN(value)) return Promise.reject(new Error('Input value is not a number'));
  if(value < 0 || value > 100) return Promise.reject(new Error('Expected a number between 0 and 100'));
  return Promise.resolve(value.toFixed(0));  // 整数の文字列にする
};

if(process.platform === 'darwin') {
  const childProcess = require('child_process');
  const path = require('path');
  const promisify = require('util').promisify;
  
  const execFile = promisify(childProcess.execFile);
  const getBrightness = stdout => {
    const brightnessResult = (/"brightness"={(.*?)}/).exec(stdout);  // `"brightness"={"max"=1024,"min"=0,"value"=806}` のような値が取れる
    if(!brightnessResult) return Promise.reject(new Error('This display is not supported'));
    const brightnessJSON = `{${brightnessResult[1].replace((/=/g), ':')}}`;  // `=` を `:` に変えて JSON 文字列として解釈できるようにする
    const brightness = JSON.parse(brightnessJSON);
    return Promise.resolve(Number((Number(brightness.value) / Number(brightness.max) * 100).toFixed(0)));  // 0〜100 で出力する
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
  module.exports.set = rawValue => input(rawValue)
    .then(value => execFile(path.join(__dirname, 'brightness-darwin'), [(Number(value) / 100).toString()], { cwd: __dirname }))
    .then(_result => {});  // `_result` には `stdout` と `stderr` プロパティがあるが、いずれも空文字なので `undefined` を返すようにしておく
}
else if(process.platform === 'linux') {
  const fs = require('fs').promises;
  const path = require('path');
  const dir = '/sys/class/backlight';
  const getBacklight = () => fs.readdir(dir).then(dirs => {
    if(!dirs.length) throw new Error('No backlight devices found');
    return dirs[0];
  });
  const getMaxBrightness = device => fs.readFile(path.join(dir, device, 'max_brightness'), 'utf8');
  const getBrightness = device => fs.readFile(path.join(dir, device, 'brightness'), 'utf8');
  const setBrightness = (device, value) => fs.writeFile(path.join(dir, device, 'brightness'), value);
  
  module.exports.get = () => getBacklight()
    .then(device => Promise.all([getMaxBrightness(device), getBrightness(device)]))
    .then(results => Number((Number(results[1]) / Number(results[0]) * 100).toFixed(0)));  // 0〜100 で出力する
  module.exports.set = rawValue => {
    let parsedValue = null;
    let detectedDevice = null;
    return input(rawValue)
      .then(value => {
        parsedValue = value;
        return getBacklight();
      })
      .then(device => {
        detectedDevice = device;
        return getMaxBrightness(detectedDevice);
      })
      .then(rawMaxBrightness => {
        const maxBrightness = Number(rawMaxBrightness);
        const brightness = Math.floor(parsedValue / 100 * maxBrightness).toString();  // 0〜1 で指定できるようにする
        return setBrightness(detectedDevice, brightness);  // `fs.writeFile()` なので `undefined` になる
      })
      .catch(error => {
        // `$ sudo -E "$(which node)" ./bin/brightness.js set 100` のように実行すればカレントユーザの node を利用して root 実行できる
        if(error.code === 'EACCES') error.message = 'You do not seem to have permission to change the brightness. Try running this command with `sudo`.';
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
