const { EventEmitter } = require('events');
const request = require('request');
const querystring = require('querystring');

const MAX_RETRIES = 4;

const ERRORS = {
  1: 'EINTERNAL (-1): An internal error has occurred. Please submit a bug report, detailing the exact circumstances in which this error occurred.',
  2: 'EARGS (-2): You have passed invalid arguments to this command.',
  3:
    'EAGAIN (-3): A temporary congestion or server malfunction prevented your request from being processed. No data was altered. Retried ' +
    MAX_RETRIES +
    ' times.',
  4: 'ERATELIMIT (-4): You have exceeded your command weight per time quota. Please wait a few seconds, then try again (this should never happen in sane real-life applications).',
  5: 'EFAILED (-5): The upload failed. Please restart it from scratch.',
  6: 'ETOOMANY (-6): Too many concurrent IP addresses are accessing this upload target URL.',
  7: 'ERANGE (-7): The upload file packet is out of range or not starting and ending on a chunk boundary.',
  8: 'EEXPIRED (-8): The upload target URL you are trying to access has expired. Please request a fresh one.',
  9: 'ENOENT (-9): Object (typically, node or user) not found. Wrong password?',
  10: 'ECIRCULAR (-10): Circular linkage attempted',
  11: 'EACCESS (-11): Access violation (e.g., trying to write to a read-only share)',
  12: 'EEXIST (-12): Trying to create an object that already exists',
  13: 'EINCOMPLETE (-13): Trying to access an incomplete resource',
  14: 'EKEY (-14): A decryption operation failed (never returned by the API)',
  15: 'ESID (-15): Invalid or expired user session, please relogin',
  16: 'EBLOCKED (-16): User blocked',
  17: 'EOVERQUOTA (-17): Request over quota',
  18: 'ETEMPUNAVAIL (-18): Resource temporarily not available, please try again later',
};

class API extends EventEmitter {
  constructor(keepalive) {
    super();
    this.keepalive = keepalive;
    this.counterId = Math.random().toString().substring(2, 10);
    this.gateway = 'https://g.api.mega.co.nz/';
  }

  request(body, cb, retryno) {
    const self = this;
    const qs = { id: (this.counterId++).toString() };
    if (this.sid) {
      qs.sid = this.sid;
    }

    request(
      {
        url: this.gateway + 'cs',
        qs: qs,
        method: 'POST',
        json: [body],
      },
      (error, _req, response) => {
        if (error) return cb(error);
        if (!response) return cb(new Error('Empty response'));

        if (response.length) response = response[0];

        if (!error && typeof response === 'number' && response < 0) {
          if (response === -3) {
            retryno = retryno || 0;
            if (retryno < MAX_RETRIES) {
              return setTimeout(function () {
                self.request(body, cb, retryno + 1);
              }, Math.pow(2, retryno + 1) * 1e3);
            }
          }
        } else {
          if (self.keepalive && response && response.sn) {
            self.pull(response.sn);
          }
        }
        cb(error, response);
      },
    );
  }

  pull(sn, retryno) {
    const self = this;

    this.sn = request(
      {
        url: this.gateway + 'sc',
        qs: { sn: sn, sid: this.sid },
        method: 'POST',
        json: true,
        body: 'sc?' + querystring.stringify({ sn: sn }),
      },
      (error, _req, response) => {
        self.sn = undefined;

        if (!error && typeof response === 'number' && response < 0) {
          if (response === -3) {
            retryno = retryno || 0;
            if (retryno < MAX_RETRIES) {
              return setTimeout(function () {
                self.pull(sn, retryno + 1);
              }, Math.pow(2, retryno + 1) * 1e3);
            }
          }
          error = new Error(ERRORS[-response]);
        }
        if (error) return console.log('Mega server req failed', error);

        if (response.w) {
          self.wait(response.w, sn);
        } else if (response.sn) {
          if (response.a) {
            self.emit('sc', response.a);
          }
          self.pull(response.sn);
        }
      },
    );
  }

  wait(url, sn) {
    const self = this;
    this.sn = request(
      {
        url: url,
        method: 'POST',
      },
      (error, _req, _body) => {
        self.sn = undefined;
        if (error) return console.log('mega server wait req failed');
        self.pull(sn);
      },
    );
  }

  close() {
    if (this.sn) this.sn.abort();
  }
}

exports.API = API;
