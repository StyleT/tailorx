'use strict';

const assert = require('assert');
const http = require('http');
const nock = require('nock');
const sinon = require('sinon');
const Tailor = require('../index');

describe('Tailor events', () => {
    let server;
    let tailor;
    const mockTemplate = sinon.stub();
    const mockContext = sinon.stub();

    beforeEach(done => {
        tailor = new Tailor({
            fetchContext: mockContext,
            pipeDefinition: () => Buffer.from(''),
            fetchTemplate: (request, parseTemplate) => {
                const template = mockTemplate(request);
                if (template) {
                    return parseTemplate(template);
                } else {
                    return Promise.reject('Error fetching template');
                }
            }
        });
        mockContext.returns(Promise.resolve({}));
        server = http.createServer(tailor.requestHandler);
        server.listen(8080, 'localhost', done);
    });

    afterEach(done => {
        mockContext.reset();
        mockTemplate.reset();
        server.close(done);
    });

    it('forwards `fragment:start(request, fragment)` event from a fragment', done => {
        const onFragmentStart = sinon.spy();
        nock('https://fragment')
            .get('/')
            .reply(200, 'hello');
        mockTemplate.returns('<fragment src="https://fragment">');
        tailor.on('fragment:start', onFragmentStart);
        http.get('http://localhost:8080/template', response => {
            const request = onFragmentStart.args[0][0];
            const fragment = onFragmentStart.args[0][1];
            assert.equal(request.url, '/template');
            assert.equal(fragment.url, 'https://fragment');
            response.resume();
            response.on('end', done);
        });
    });

    it('emits `start(request)` event', done => {
        const onStart = sinon.spy();
        nock('https://fragment')
            .get('/')
            .reply(200, 'hello');
        mockTemplate.returns('<fragment src="https://fragment">');
        tailor.on('start', onStart);
        http.get('http://localhost:8080/template', response => {
            response.resume();
            response.on('end', () => {
                const request = onStart.args[0][0];
                assert.equal(request.url, '/template');
                assert.equal(onStart.callCount, 1);
                done();
            });
        });
    });

    it('emits `response(request, statusCode, headers)` event', done => {
        const onResponse = sinon.spy();
        mockTemplate.returns('<html>');
        tailor.on('response', onResponse);
        http.get('http://localhost:8080/template', response => {
            response.resume();
            response.on('end', () => {
                const request = onResponse.args[0][0];
                const statusCode = onResponse.args[0][1];
                const headers = onResponse.args[0][2];
                assert.equal(request.url, '/template');
                assert.equal(statusCode, 200);
                assert.deepEqual(headers, {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Content-Type': 'text/html',
                    Pragma: 'no-cache'
                });
                assert.equal(onResponse.callCount, 1);
                done();
            });
        });
    });

    it('emits `end(request, contentSize)` event', done => {
        const onEnd = sinon.spy();
        mockTemplate.returns(
            '<html><head></head><body><h2></h2></body></html>'
        );
        tailor.on('end', onEnd);
        http.get('http://localhost:8080/template', response => {
            response.resume();
            response.on('end', () => {
                const request = onEnd.args[0][0];
                const contentSize = onEnd.args[0][1];
                assert.equal(request.url, '/template');
                assert.equal(contentSize, 48);
                assert.equal(onEnd.callCount, 1);
                done();
            });
        });
    });

    it('emits `error(request, error, response)` event on primary error/timeout', done => {
        const onPrimaryError = sinon.stub().callsFake((req, err, res) => {
            res.statusCode = 500;
            res.end('error response');
        });
        nock('https://fragment')
            .get('/')
            .reply(500);
        mockTemplate.returns(
            '<fragment id="tst_fragment" primary src="https://fragment">'
        );
        tailor.on('error', onPrimaryError);
        http.get('http://localhost:8080/template', response => {
            const request = onPrimaryError.args[0][0];
            const error = onPrimaryError.args[0][1];

            assert.equal(request.url, '/template');
            assert.equal(error.message, 'Fragment error for "tst_fragment"');

            let rawData = '';
            response.on('data', chunk => (rawData += chunk));
            response.on('end', () => {
                assert.equal(rawData, 'error response');
                done();
            });
        });
    });

    it('emits `error(request, error, response)` event on template error', done => {
        const onTemplateError = sinon.stub().callsFake((req, err, res) => {
            res.statusCode = 500;
            res.end('error response');
        });
        mockTemplate.returns(false);
        tailor.on('error', onTemplateError);
        http.get('http://localhost:8080/template', response => {
            const request = onTemplateError.args[0][0];
            const error = onTemplateError.args[0][1];

            assert.equal(request.url, '/template');
            assert.equal(error, 'Error fetching template');

            let rawData = '';
            response.on('data', chunk => (rawData += chunk));
            response.on('end', () => {
                assert.equal(rawData, 'error response');
                done();
            });
        });
    });

    it('emits `error(request, error, response)` event on error in context function', done => {
        const errMsg = 'Error fetching context';
        const onContextError = sinon.spy((req, err, res) => {
            res.statusCode = 500;
            res.end();
        });
        tailor.on('error', onContextError);

        const rejectPrm = Promise.reject(errMsg);
        rejectPrm.catch(() => {});
        mockContext.returns(rejectPrm);

        mockTemplate.returns('<html>');

        http.get('http://localhost:8080/template', response => {
            const request = onContextError.args[0][0];
            const error = onContextError.args[0][1];
            assert.equal(request.url, '/template');
            assert.equal(error, errMsg);
            response.resume();
            response.on('end', done);
        });
    });
});
