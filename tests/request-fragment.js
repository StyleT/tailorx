'use strict';

const https = require('https');
const sinon = require('sinon');
const assert = require('assert');
const nock = require('nock');
const filterHeaderFn = () => ({});
const processFragmentResponseFn = require('../lib/process-fragment-response');
const requestFragment = require('../lib/request-fragment')(
    filterHeaderFn,
    processFragmentResponseFn
);

describe('requestFragment', () => {
    let fragmentAttrb;
    beforeEach(() => {
        fragmentAttrb = {
            timeout: 1000
        };
    });

    it('Should request fragment using http protocol', done => {
        nock('http://fragment')
            .get('/')
            .reply(200, 'HTTP');
        requestFragment('http://fragment/', fragmentAttrb, {
            headers: {}
        }).then(response => {
            const chunks = [];
            response.on('data', chunk => {
                chunks.push(chunk);
            });
            response.on('end', () => {
                const data = Buffer.concat(chunks).toString('utf8');
                assert.equal(data, 'HTTP');
                done();
            });
        });
    });

    describe('while using HTTPS protocol', () => {
        let requestSpy;

        const request = {
            headers: {}
        };

        beforeEach(() => {
            requestSpy = sinon.spy(https, 'request');
            nock('https://fragment')
                .get('/')
                .reply(200, 'HTTPS');
        });

        afterEach(() => {
            requestSpy.restore();
        });

        it('Should request fragment', done => {
            const fragmentAttributes = {
                ...fragmentAttrb,
                ignoreInvalidSsl: false
            };

            requestFragment(
                'https://fragment/',
                fragmentAttributes,
                request
            ).then(response => {
                let chunks = [];
                response.on('data', chunk => {
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    const data = Buffer.concat(chunks).toString('utf8');
                    assert.equal(data, 'HTTPS');
                    assert.ok(
                        requestSpy.neverCalledWithMatch({
                            rejectUnauthorized: false
                        })
                    );
                    done();
                });
            });
        });

        it('Should ignore invalid SSL certificates while requesting a fragment', done => {
            const fragmentAttributes = {
                ...fragmentAttrb,
                ignoreInvalidSsl: true
            };

            requestFragment(
                'https://fragment/',
                fragmentAttributes,
                request
            ).then(response => {
                let chunks = [];
                response.on('data', chunk => {
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    const data = Buffer.concat(chunks).toString('utf8');
                    assert.equal(data, 'HTTPS');
                    assert.ok(
                        requestSpy.calledWithMatch({
                            rejectUnauthorized: false
                        })
                    );
                    done();
                });
            });
        });
    });

    it('Should reject promise and respond with error for status code >500', done => {
        nock('http://fragment')
            .get('/')
            .reply(500, 'Internal Server Error');
        requestFragment('http://fragment/', fragmentAttrb, { headers: {} })
            .catch(err => {
                assert.equal(
                    err.message,
                    'Request fragment error. statusCode: 500; statusMessage: null; url: http://fragment/;'
                );
            })
            .then(done, done);
    });

    it('Should resolve promise for primary fragment with non 2xx response', done => {
        nock('http://fragment')
            .get('/')
            .reply(300, 'Redirect');
        requestFragment(
            'http://fragment/',
            { ...fragmentAttrb, primary: true },
            { headers: {} }
        )
            .then(response => {
                assert.equal(response.statusCode, 300);
            })
            .then(done, done);
    });

    it('Should reject promise for non primary fragment with non 2xx response', done => {
        nock('http://fragment')
            .get('/')
            .reply(300, 'Redirect');
        requestFragment(
            'http://fragment/',
            { ...fragmentAttrb, primary: false },
            { headers: {} }
        )
            .catch(err => {
                assert.equal(
                    err.message,
                    'Request fragment error. statusCode: 300; statusMessage: null; url: http://fragment/;'
                );
            })
            .then(done, done);
    });

    it('Should timeout when the fragment is not reachable', done => {
        nock('http://fragment')
            .get('/')
            .socketDelay(1001)
            .reply(200, 'hello');
        requestFragment('http://fragment/', fragmentAttrb, { headers: {} })
            .catch(err => {
                assert.equal(err.message, 'socket hang up');
            })
            .then(done, done);
    });
});
