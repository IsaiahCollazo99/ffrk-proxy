const Proxy = require('./thin');
const address = require('address');
const events = require('events');
const util = require('util');
const fs = require('fs');

const helpers = require('./helpers');
const config = require('./config');

function FFRKProxy(certStore) {
  this.whitelist = false;

  if (config.get('application.proxy.whitelist')) {
    this.whitelist = {
      'ffrk.denagames.com': {
        cert: __dirname + '/../cert/wwe.crt',
        key: __dirname + '/../cert/wwe.key',
      },
      'dff.sp.mbga.jp': {
        cert: __dirname + '/../cert/jp.crt',
        key: __dirname + '/../cert/jp.key',
      },
    };
  }

  this.proxy = new Proxy({
    followRedirect: true,
    strictSSL: false,
    rejectUnauthorized: false,
    SNICallback: helpers.makeSNICallback(
      certStore.rootCaCert,
      certStore.rootCaKey
    ),
    cert: certStore.defaultCaCert,
    key: certStore.defaultCaKey,
    whitelist: this.whitelist,
  });

  this.proxy.use(this.middleware.bind(this));
}

util.inherits(FFRKProxy, events.EventEmitter);

FFRKProxy.prototype.listen = function(port, host, callback) {
  this.proxy.listen(port, host, callback);
};

FFRKProxy.prototype.close = function() {
  this.proxy.close();
};

FFRKProxy.prototype.middleware = function(clientReq, clientRes, next) {
  const _this = this;
  let reqUrl = clientReq.url;

  if (clientReq.connection.encrypted) {
    reqUrl = 'https://' + clientReq.headers.host + reqUrl;
  }

  console.log('Proxying:', clientReq.method, reqUrl);
  this.proxy.forward(clientReq, clientRes, function(proxyReq) {
    proxyReq.on('response', function(response) {
      let transform = null;
      const domains = [
        'ffrk.denagames.com',
        'dff.sp.mbga.jp',
      ];

      if (domains.indexOf(clientReq.headers.host) > -1) {
        if (
          config.get('application.proxy.method') === 'inject' &&
          clientReq.url.indexOf('/battle/?') > -1
        ) {
          transform = function(content, callback) {
            const jsPath = 'http://' + address.ip() + ':' + config.get('application.cert.port')+ '/js/';
            content = content.toString();
            content = content.replace('</body>', '<script type="application/javascript">' +
              'var inject = {};' +
              '</script>' +
              '<script type="application/javascript" src="' + jsPath + 'inject.js"></script>' +
              '<script type="application/javascript" src="' + jsPath + 'buddy.js"></script>' +
              '<script type="application/javascript" src="' + jsPath + 'enemy.js"></script>' +
              '<script type="application/javascript" src="' + jsPath + 'magicite.js"></script>' +
              '<script type="application/javascript" src="' + jsPath + 'rounds.js"></script>' +
              '<script type="application/javascript" src="' + jsPath + 'supporter.js"></script>' +
              '</body>');

            callback(content);
          };
        } else if (
          config.get('application.proxy.method') === 'intercept' &&
          clientReq.url.indexOf('get_battle_init_data') > -1
        ) {
          console.info('number of event listener for "battleInitData"', _this.listeners('battleInitData').length);

          if (_this.listeners('battleInitData').length > 0) {
            transform = function(content, callback, isJson) {
              const json = helpers.jsonParse(content);

              _this.dumpJsonResponse('get_battle_init_data', content);
              _this.emit('battleInitData', json, callback);
            };
          }
        }
      }

      if (typeof transform === 'function' && transform.length === 3) {
        helpers.sendModifiedJsonResponse(clientRes, response, transform);
      } else if (typeof transform === 'function') {
        helpers.sendModifiedResponse(clientRes, response, transform);
      } else {
        helpers.sendOriginalResponse(clientRes, response);
      }
    });

    proxyReq.on('error', function(err) {
      console.error(err, err.stack.split('\n'));
      clientRes.end();
    });
  });
};

FFRKProxy.prototype.dumpJsonResponse = function(name, content) {
  if (config.get('application.dump.' + name)) {
    const filename = name + '-' + process.hrtime() + '.json';
    fs.writeFile(__dirname + '/../dump/' + filename, content, function(err) {
      if (err) {
        console.error('Failed to write "' + filename + '" dump');
      }
    });
  }
};

module.exports = FFRKProxy;
